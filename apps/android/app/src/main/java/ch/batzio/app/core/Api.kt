package ch.batzio.app.core

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.serializer
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(val status: Int, val code: String, override val message: String, val fields: Map<String, String> = emptyMap()) : Exception(message) {
    val isUnauthorized get() = status == 401
}

/** A file to upload (attachments, drops, bank statements). */
class UploadFile(val name: String, val mimeType: String, val bytes: ByteArray)

class Download(val bytes: ByteArray, val filename: String, val mimeType: String)

@Serializable private data class ErrorBody(val code: String, val message: String, val fields: Map<String, String>? = null)
@Serializable private data class ErrorEnvelope(val error: ErrorBody)

/**
 * Talks to a Batzio server: `Authorization: Bearer <session>`, `X-Tenant` for the
 * chosen company and `Accept-Language` so every text comes back translated.
 */
class Api(
    val baseUrl: String,
    val token: String? = null,
    val tenant: String? = null,
    val locale: String = "en",
    val mode: String = "simple",
) {
    companion object {
        val http: OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.MINUTES)
            .build()
        private val JSON = "application/json; charset=utf-8".toMediaType()

        /** "Batzio-Android/0.1.0 (Android 16)": the audit log shows which app made a change. */
        val USER_AGENT = "Batzio-Android/${ch.batzio.app.BuildConfig.VERSION_NAME} (Android ${android.os.Build.VERSION.RELEASE})"

        /** The file name of a `Content-Disposition` header, preferring the exact UTF-8 one (`filename*=`). */
        fun filenameFrom(header: String): String? {
            Regex("filename\\*=UTF-8''([^;]+)", RegexOption.IGNORE_CASE).find(header)?.groupValues?.get(1)
                ?.let { runCatching { java.net.URLDecoder.decode(it.replace("+", "%2B"), "UTF-8") }.getOrNull() }
                ?.takeIf { it.isNotEmpty() }
                ?.let { return it }
            return Regex("filename=\"?([^\";]+)\"?").find(header)?.groupValues?.get(1)
        }
    }

    fun url(path: String, query: Map<String, String?> = emptyMap()): HttpUrl {
        val base = baseUrl.trimEnd('/').toHttpUrl()
        val b = base.newBuilder()
        path.trim('/').split('/').filter { it.isNotEmpty() }.forEach { b.addPathSegment(it) }
        query.toSortedMap().forEach { (k, v) -> if (v != null) b.addQueryParameter(k, v) }
        b.addQueryParameter("locale", locale)
        return b.build()
    }

    private fun builder(path: String, query: Map<String, String?>): Request.Builder =
        Request.Builder().url(url(path, query)).apply {
            header("Accept", "application/json")
            header("Accept-Language", locale)
            header("User-Agent", USER_AGENT)
            token?.let { header("Authorization", "Bearer $it") }
            tenant?.let { header("X-Tenant", it) }
        }

    private fun v1(path: String) = if (path.startsWith("/api/")) path else "/api/v1$path"

    /** On this device, requests go to the engine instead of the network. */
    private val client: OkHttpClient get() = if (LocalEngine.isOnDevice(baseUrl)) LocalEngine.current().http else http

    private suspend fun execute(original: Request): Response = withContext(Dispatchers.IO) {
        // A write sent twice (a retry after a dropped connection) is answered once.
        val request = if (original.method != "GET") original.newBuilder().header("Idempotency-Key", java.util.UUID.randomUUID().toString()).build() else original
        val response = try {
            try {
                client.newCall(request).execute()
            } catch (e: IOException) {
                if (request.method == "GET") throw e
                // Safe to send again: the same key makes the server answer the first attempt.
                kotlinx.coroutines.delay(1000)
                client.newCall(request).execute()
            }
        } catch (e: IOException) {
            throw ApiException(0, "offline", L("Batzio can’t be reached. Check your connection and the server address."))
        } catch (e: IllegalStateException) {
            throw ApiException(500, "local", e.message ?: L("Batzio could not start on this device."))
        }
        if (!response.isSuccessful) {
            val text = response.body.string()
            val parsed = runCatching { BzJson.decodeFromString<ErrorEnvelope>(text).error }.getOrNull()
            response.close()
            throw ApiException(response.code, parsed?.code ?: "http_${response.code}", parsed?.message ?: response.message, parsed?.fields ?: emptyMap())
        }
        response
    }

    private suspend fun <T> decode(response: Response, serializer: KSerializer<T>): T = withContext(Dispatchers.IO) {
        val text = response.use { it.body.string() }
        val data = BzJson.parseToJsonElement(text).jsonObject["data"] ?: kotlinx.serialization.json.JsonNull
        BzJson.decodeFromJsonElement(serializer, data)
    }

    suspend fun <T> get(path: String, serializer: KSerializer<T>, query: Map<String, String?> = emptyMap()): T =
        decode(execute(builder(v1(path), query).get().build()), serializer)

    suspend inline fun <reified T> get(path: String, query: Map<String, String?> = emptyMap()): T = get(path, serializer<T>(), query)

    suspend fun <T> send(method: String, path: String, body: JsonElement, serializer: KSerializer<T>, query: Map<String, String?> = emptyMap()): T {
        val rb = BzJson.encodeToString(JsonElement.serializer(), body).toRequestBody(JSON)
        return decode(execute(builder(v1(path), query).method(method, rb).build()), serializer)
    }

    suspend inline fun <reified T> send(method: String, path: String, body: JsonElement = JsonObject(emptyMap()), query: Map<String, String?> = emptyMap()): T =
        send(method, path, body, serializer<T>(), query)

    suspend fun download(path: String, query: Map<String, String?> = emptyMap()): Download {
        val response = execute(builder(v1(path), query).header("Accept", "*/*").get().build())
        return withContext(Dispatchers.IO) {
            response.use {
                val disposition = it.header("Content-Disposition") ?: ""
                val name = filenameFrom(disposition) ?: path.substringAfterLast('/')
                Download(it.body.bytes(), name, it.header("Content-Type") ?: "application/octet-stream")
            }
        }
    }

    suspend fun <T> upload(path: String, files: List<UploadFile>, serializer: KSerializer<T>, fileField: String = "files", fields: Map<String, String> = emptyMap(), query: Map<String, String?> = emptyMap()): T {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (k, v) -> addFormDataPart(k, v) }
            files.forEach { f -> addFormDataPart(fileField, f.name, f.bytes.toRequestBody(f.mimeType.toMediaType())) }
        }.build()
        return decode(execute(builder(v1(path), query).post(body).build()), serializer)
    }

    suspend inline fun <reified T> upload(path: String, files: List<UploadFile>, fileField: String = "files", fields: Map<String, String> = emptyMap(), query: Map<String, String?> = emptyMap()): T =
        upload(path, files, serializer<T>(), fileField, fields, query)

    suspend inline fun <reified T> sendRaw(path: String, bytes: ByteArray, contentType: String, query: Map<String, String?> = emptyMap()): T =
        sendRawBody(path, bytes.toRequestBody(contentType.toMediaType()), serializer<T>(), query)

    suspend fun <T> sendRawBody(path: String, body: RequestBody, serializer: KSerializer<T>, query: Map<String, String?>): T =
        decode(execute(builder(v1(path), query).post(body).build()), serializer)

    /** Streams Batzi's work as it happens (NDJSON from `/api/agent`). */
    fun agent(body: JsonObject): Flow<AgentEvent> = flow {
        val withLocale = JsonObject(body + ("locale" to json(locale)))
        val request = builder("/api/agent", emptyMap())
            .header("Accept", "application/x-ndjson")
            .post(BzJson.encodeToString(JsonElement.serializer(), withLocale).toRequestBody(JSON))
            .build()
        val response = execute(request)
        response.use {
            val source = it.body.source()
            while (true) {
                val line = source.readUtf8Line() ?: break
                AgentEvent.parse(line)?.let { e -> emit(e) }
            }
        }
    }.flowOn(Dispatchers.IO)
}

/** One line of Batzi's stream. */
sealed interface AgentEvent {
    data class Thread(val id: String) : AgentEvent
    data class Text(val delta: String) : AgentEvent
    data class Update(val text: String) : AgentEvent
    data class Tool(val outcome: ToolOutcome) : AgentEvent
    data class Done(val refused: Boolean) : AgentEvent
    data class Error(val message: String) : AgentEvent

    companion object {
        fun parse(line: String): AgentEvent? {
            if (line.isBlank()) return null
            val o = runCatching { BzJson.parseToJsonElement(line).jsonObject }.getOrNull() ?: return null
            return when (o["type"].str) {
                "thread" -> o["threadId"].str?.let { Thread(it) }
                "text" -> Text(o["delta"].str ?: "")
                "update" -> Update(o["text"].str ?: "")
                "tool" -> o["outcome"]?.let { runCatching { Tool(BzJson.decodeFromJsonElement<ToolOutcome>(it)) }.getOrNull() }
                "done" -> Done(o["refused"].bool ?: false)
                "error" -> Error(o["message"].str ?: "")
                else -> null
            }
        }
    }
}
