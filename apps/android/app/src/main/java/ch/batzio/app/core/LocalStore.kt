package ch.batzio.app.core

import android.util.Base64
import androidx.sqlite.SQLITE_DATA_BLOB
import androidx.sqlite.SQLITE_DATA_FLOAT
import androidx.sqlite.SQLITE_DATA_INTEGER
import androidx.sqlite.SQLITE_DATA_TEXT
import androidx.sqlite.SQLiteConnection
import androidx.sqlite.SQLiteDriver
import androidx.sqlite.execSQL
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.File

/**
 * The SQLite files and attachments of the on-device mode, spoken to the way the
 * engine expects (D1 semantics): `control.sqlite`, `tenant-NNN.sqlite` per
 * company and `files/`. Used from the engine's single bridge thread only.
 */
class LocalStore(val directory: File, private val driver: SQLiteDriver) {
    private val connections = mutableMapOf<String, SQLiteConnection>()

    init {
        File(directory, "files").mkdirs()
    }

    private fun connection(binding: String): SQLiteConnection = connections.getOrPut(binding) {
        val name = if (binding == "DB") "control" else binding.replace("TENANT_DB_", "tenant-")
        require(Regex("""^(control|tenant-\d{3})$""").matches(name)) { "Unknown database $binding" }
        driver.open(File(directory, "$name.sqlite").path).also {
            // D1 enforces foreign keys; WAL keeps the file consistent if the app is killed mid-write.
            it.execSQL("PRAGMA foreign_keys = ON")
            it.prepare("PRAGMA journal_mode = WAL").use { s -> s.step() }
        }
    }

    /** `{"rows": [...], "changes": n, "lastRowId": n}` or `{"error": "…"}`. */
    fun query(binding: String, sql: String, params: String): String = encode {
        run(connection(binding), sql, BzJson.parseToJsonElement(params).jsonArray)
    }

    fun batch(binding: String, statements: String): String = encode {
        val db = connection(binding)
        db.execSQL("BEGIN IMMEDIATE")
        try {
            val results = BzJson.parseToJsonElement(statements).jsonArray.map { s ->
                val o = s.jsonObject
                run(db, (o["sql"] as JsonPrimitive).content, o["params"]?.jsonArray ?: JsonArray(emptyList()))
            }
            db.execSQL("COMMIT")
            JsonArray(results)
        } catch (e: Throwable) {
            runCatching { db.execSQL("ROLLBACK") }
            throw e
        }
    }

    private fun run(db: SQLiteConnection, sql: String, params: JsonArray): JsonObject {
        val rows = mutableListOf<JsonElement>()
        db.prepare(sql).use { stmt ->
            params.forEachIndexed { i, value ->
                val index = i + 1
                when {
                    value is JsonNull -> stmt.bindNull(index)
                    value is JsonObject -> stmt.bindBlob(index, Base64.decode((value["\$bytes"] as? JsonPrimitive)?.content ?: "", Base64.NO_WRAP))
                    value is JsonPrimitive && value.isString -> stmt.bindText(index, value.content)
                    value is JsonPrimitive && value.booleanOrNull != null -> stmt.bindLong(index, if (value.booleanOrNull == true) 1 else 0)
                    // JSON writes whole numbers without a fraction.
                    value is JsonPrimitive && value.longOrNull != null -> stmt.bindLong(index, value.longOrNull!!)
                    value is JsonPrimitive && value.doubleOrNull != null -> stmt.bindDouble(index, value.doubleOrNull!!)
                    else -> stmt.bindText(index, value.toString())
                }
            }
            val columns = stmt.getColumnCount()
            while (stmt.step()) {
                rows += buildJsonObject {
                    for (c in 0 until columns) {
                        val name = stmt.getColumnName(c)
                        when (stmt.getColumnType(c)) {
                            SQLITE_DATA_INTEGER -> put(name, stmt.getLong(c))
                            SQLITE_DATA_FLOAT -> put(name, stmt.getDouble(c))
                            SQLITE_DATA_TEXT -> put(name, stmt.getText(c))
                            SQLITE_DATA_BLOB -> put(name, buildJsonObject { put("\$bytes", Base64.encodeToString(stmt.getBlob(c), Base64.NO_WRAP)) })
                            else -> put(name, JsonNull)
                        }
                    }
                }
            }
        }
        val readOnly = Regex("""^\s*(select|with|pragma|explain)\b""", RegexOption.IGNORE_CASE).containsMatchIn(sql)
        var changes = 0L
        var lastRowId = 0L
        if (!readOnly) {
            db.prepare("SELECT changes(), last_insert_rowid()").use { s ->
                if (s.step()) {
                    changes = s.getLong(0)
                    lastRowId = s.getLong(1)
                }
            }
        }
        return buildJsonObject {
            put("rows", JsonArray(rows))
            put("changes", changes)
            put("lastRowId", lastRowId)
        }
    }

    // ------------------------------------------------------------ files

    /** Storage keys look like `<tenant>/<uuid>/<name>`; every segment is kept to safe characters. */
    private fun file(key: String): File? {
        val segments = key.split('/').map { s -> s.map { c -> if (c.isLetterOrDigit() && c.code < 128 || c in "-_.") c.toString() else "%%%04x".format(c.code) }.joinToString("") }
        if (segments.isEmpty() || segments.any { it.isEmpty() || it == "." || it == ".." }) return null
        return segments.fold(File(directory, "files")) { dir, s -> File(dir, s) }
    }

    fun fileGet(key: String): String? {
        val f = file(key)?.takeIf { it.isFile } ?: return null
        val type = File(f.path + ".content-type").takeIf { it.isFile }?.readText() ?: "application/octet-stream"
        return buildJsonObject {
            put("data", Base64.encodeToString(f.readBytes(), Base64.NO_WRAP))
            put("type", type)
        }.toString()
    }

    fun filePut(key: String, data: String, type: String) {
        val f = file(key) ?: return
        f.parentFile?.mkdirs()
        f.writeBytes(Base64.decode(data, Base64.NO_WRAP))
        File(f.path + ".content-type").writeText(type)
    }

    fun fileDelete(key: String) {
        val f = file(key) ?: return
        f.delete()
        File(f.path + ".content-type").delete()
    }

    fun close() {
        connections.values.forEach { runCatching { it.close() } }
        connections.clear()
    }

    private fun encode(work: () -> JsonElement): String =
        try {
            work().toString()
        } catch (e: Throwable) {
            buildJsonObject { put("error", e.message ?: e.toString()) }.toString()
        }
}
