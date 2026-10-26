package ch.batzio.app.core

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.sqlite.driver.bundled.BundledSQLiteDriver
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * Batzio without a server: the engine (`packages/local`, one script shipped in
 * the assets) runs in a hidden WebView on SQLite files in [directory]. The app
 * reaches it through the same REST API as online, at [ORIGIN], via [http].
 */
class LocalEngine private constructor(context: Context, val directory: File) {
    companion object {
        const val ORIGIN = "https://device.batzio.local"

        @Volatile private var instance: LocalEngine? = null

        /** The on-device folder: app storage, backed up with the app. */
        fun defaultDirectory(context: Context) = File(context.filesDir, "on-this-device")

        fun get(context: Context): LocalEngine =
            instance ?: synchronized(this) { instance ?: LocalEngine(context.applicationContext, defaultDirectory(context)).also { instance = it } }

        /** The running engine, for the API client. */
        fun current(): LocalEngine = instance ?: error(L("Batzio could not start on this device."))

        fun isOnDevice(baseUrl: String) = baseUrl.trimEnd('/') == ORIGIN

        /** Stops the engine and closes its files (before deleting them). */
        fun shutdown() = synchronized(this) {
            instance?.let { e -> Handler(Looper.getMainLooper()).post { e.webView?.destroy() }; e.store.close() }
            instance = null
        }
    }

    private val store = LocalStore(directory, BundledSQLiteDriver())
    private val ready = CompletableDeferred<Unit>()
    private val pending = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val ids = AtomicLong()
    private var webView: WebView? = null
    private val script = { context.assets.open("batzio-local.js") }

    init {
        Handler(Looper.getMainLooper()).post { start(context) }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun start(context: Context) {
        val view = WebView(context)
        view.settings.javaScriptEnabled = true
        view.settings.allowFileAccess = false
        view.settings.allowContentAccess = false
        view.addJavascriptInterface(Bridge(), "__batzio_host_android")
        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) android.util.Log.w("BatzioLocal", "${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }
        view.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val url = request.url.toString()
                if (url == "$ORIGIN/batzio-local.js") return WebResourceResponse("text/javascript", "utf-8", script())
                // The page itself arrives as data; nothing else leaves the device.
                if (url.startsWith("http")) return WebResourceResponse("text/plain", "utf-8", 404, "Not found", emptyMap(), "".byteInputStream())
                return null
            }

            override fun onPageFinished(view: WebView, url: String?) {
                view.evaluateJavascript("typeof BatzioLocal") { type ->
                    if (type.contains("object")) ready.complete(Unit) else ready.completeExceptionally(IllegalStateException(L("Batzio could not start on this device.")))
                }
            }
        }
        val page = """<!doctype html><meta charset="utf-8"><script>window.__batzio_host = window.__batzio_host_android;</script>""" +
            """<script src="/batzio-local.js"></script><script>BatzioLocal.configure('{"tenantSlots":20}')</script>"""
        view.loadDataWithBaseURL("$ORIGIN/", page, "text/html", "utf-8", null)
        webView = view
    }

    /** Sends one request (`{method, url, headers, body}` as JSON) and returns the engine's JSON answer. */
    suspend fun send(wire: String): String {
        withTimeout(30_000) { ready.await() }
        val id = ids.incrementAndGet().toString()
        val answer = CompletableDeferred<String>()
        pending[id] = answer
        Handler(Looper.getMainLooper()).post {
            webView?.evaluateJavascript("BatzioLocal.dispatch(${JSONObject.quote(id)}, ${JSONObject.quote(wire)})", null)
        }
        return withTimeout(10 * 60_000) { answer.await() }
    }

    /** OkHttp client whose requests never touch the network: they are answered by the engine. */
    val http: OkHttpClient = OkHttpClient.Builder()
        .readTimeout(10, TimeUnit.MINUTES)
        .addInterceptor(Interceptor { chain -> answer(chain.request()) })
        .build()

    private fun answer(request: okhttp3.Request): Response {
        val body = request.body?.let { b ->
            val buffer = Buffer()
            b.writeTo(buffer)
            Base64.encodeToString(buffer.readByteArray(), Base64.NO_WRAP)
        }
        val headers = request.headers.toMutableList().map { (k, v) -> JsonArray(listOf(JsonPrimitive(k), JsonPrimitive(v))) }.toMutableList()
        request.body?.contentType()?.let { headers += JsonArray(listOf(JsonPrimitive("content-type"), JsonPrimitive(it.toString()))) }
        val wire = buildJsonObject {
            put("method", request.method)
            put("url", request.url.toString())
            put("headers", JsonArray(headers))
            put("body", body?.let { JsonPrimitive(it) } ?: JsonNull)
        }.toString()
        val reply = BzJson.parseToJsonElement(runBlocking { send(wire) }).jsonObject
        val responseHeaders = reply["headers"]?.jsonArray?.map { it.jsonArray[0].jsonPrimitive.content to it.jsonArray[1].jsonPrimitive.content } ?: emptyList()
        val type = responseHeaders.firstOrNull { it.first.equals("content-type", true) }?.second
        val bytes = Base64.decode(reply["body"]?.jsonPrimitive?.content ?: "", Base64.NO_WRAP)
        return Response.Builder()
            .request(request)
            .protocol(Protocol.HTTP_1_1)
            .code(reply["status"]?.jsonPrimitive?.int ?: 500)
            .message("")
            .apply { responseHeaders.forEach { (k, v) -> addHeader(k, v) } }
            .body(bytes.toResponseBody(type?.toMediaTypeOrNull()))
            .build()
    }

    /** What the engine calls back into (packages/local/src/host-api.ts); runs on the WebView's bridge thread. */
    private inner class Bridge {
        private val random = SecureRandom()

        @JavascriptInterface fun query(db: String, sql: String, params: String): String = store.query(db, sql, params)
        @JavascriptInterface fun batch(db: String, statements: String): String = store.batch(db, statements)
        @JavascriptInterface fun fileGet(key: String): String? = store.fileGet(key)
        @JavascriptInterface fun filePut(key: String, data: String, type: String) = store.filePut(key, data, type)
        @JavascriptInterface fun fileDelete(key: String) = store.fileDelete(key)

        @JavascriptInterface fun random(n: Int): String = Base64.encodeToString(ByteArray(n).also(random::nextBytes), Base64.NO_WRAP)

        @JavascriptInterface fun sha256(data: String): String =
            Base64.encodeToString(MessageDigest.getInstance("SHA-256").digest(Base64.decode(data, Base64.NO_WRAP)), Base64.NO_WRAP)

        @JavascriptInterface fun pbkdf2(password: String, salt: String, iterations: Int, bits: Int): String {
            // The engine hands over the password's UTF-8 bytes; PBEKeySpec wants characters.
            val chars = String(Base64.decode(password, Base64.NO_WRAP), Charsets.UTF_8).toCharArray()
            val spec = PBEKeySpec(chars, Base64.decode(salt, Base64.NO_WRAP), iterations, bits)
            return Base64.encodeToString(SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded, Base64.NO_WRAP)
        }

        @JavascriptInterface fun log(level: String, message: String) {
            if (level == "error" || level == "warn") android.util.Log.w("BatzioLocal", message)
        }

        @JavascriptInterface fun respond(id: String, response: String) {
            pending.remove(id)?.complete(response)
        }
    }
}
