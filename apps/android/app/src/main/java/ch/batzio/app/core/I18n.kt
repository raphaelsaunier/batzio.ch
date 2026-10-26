package ch.batzio.app.core

import android.content.Context
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.Locale

/**
 * The shared EN/DE/FR/IT catalog (generated from packages/i18n by `pnpm gen`).
 * Keys are the English text, exactly as on the web.
 */
object I18n {
    val supported = listOf("en", "de", "fr", "it")

    @Volatile var locale: String = preferred()
        set(value) { field = if (value in supported) value else "en" }

    @Volatile private var table: Map<String, Map<String, String>> = emptyMap()

    fun load(context: Context) {
        val text = context.assets.open("strings.json").bufferedReader().use { it.readText() }
        load(text)
    }

    fun load(json: String) {
        table = BzJson.parseToJsonElement(json).jsonObject.mapValues { (_, v) ->
            v.jsonObject.mapValues { (_, t) -> t.jsonPrimitive.content }
        }
    }

    /** The device's (or this app's chosen) language among the supported ones. */
    fun preferred(locale: Locale = Locale.getDefault()): String = locale.language.takeIf { it in supported } ?: "en"

    fun translate(key: String, lang: String = locale): String = if (lang == "en") key else table[lang]?.get(key) ?: key

    fun interpolate(text: String, vars: Map<String, Any?>): String =
        vars.entries.fold(text) { acc, (k, v) -> acc.replace("{$k}", v?.toString() ?: "") }

    /** Swiss formatting locale for the current language (de-CH, fr-CH, …). */
    val formattingLocale: Locale get() = Locale.Builder().setLanguage(locale).setRegion("CH").build()
}

/** Translates an English UI string: `L("Today")`, `L("{n} records", "n" to 3)`. */
fun L(key: String, vararg vars: Pair<String, Any?>): String = I18n.interpolate(I18n.translate(key), vars.toMap())
