package ch.batzio.app.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/** Records travel as JSON objects: their shape comes from the server's resource definitions. */
typealias Record = Map<String, JsonElement>

val BzJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
    encodeDefaults = true
}

val JsonElement?.isNull: Boolean get() = this == null || this is JsonNull

val JsonElement?.str: String?
    get() = when (this) {
        is JsonPrimitive -> if (this is JsonNull) null else {
            val d = doubleOrNull
            if (!isString && d != null && d == Math.rint(d) && kotlin.math.abs(d) < 9e15) d.toLong().toString() else contentOrNull
        }
        else -> null
    }

val JsonElement?.num: Double?
    get() = when (this) {
        is JsonPrimitive -> if (this is JsonNull) null else doubleOrNull ?: booleanOrNull?.let { if (it) 1.0 else 0.0 }
        else -> null
    }

val JsonElement?.int: Int? get() = num?.toInt()

val JsonElement?.bool: Boolean?
    get() = when (this) {
        is JsonPrimitive -> if (this is JsonNull) null else booleanOrNull ?: doubleOrNull?.let { it != 0.0 } ?: contentOrNull?.lowercase()?.let { it == "true" || it == "1" }
        else -> null
    }

val JsonElement?.arr: List<JsonElement>? get() = this as? JsonArray
val JsonElement?.obj: Map<String, JsonElement>? get() = this as? JsonObject

/** Plain text for display when nothing better is known. */
val JsonElement?.display: String
    get() = when (this) {
        null, is JsonNull -> ""
        is JsonArray -> joinToString(", ") { it.display }
        is JsonObject -> ""
        else -> str ?: ""
    }

fun json(value: Any?): JsonElement = when (value) {
    null -> JsonNull
    is JsonElement -> value
    is String -> JsonPrimitive(value)
    is Number -> JsonPrimitive(value)
    is Boolean -> JsonPrimitive(value)
    is Map<*, *> -> JsonObject(value.entries.associate { (k, v) -> k.toString() to json(v) })
    is List<*> -> JsonArray(value.map { json(it) })
    else -> JsonPrimitive(value.toString())
}

fun obj(vararg pairs: Pair<String, Any?>): JsonObject = JsonObject(pairs.associate { (k, v) -> k to json(v) })
