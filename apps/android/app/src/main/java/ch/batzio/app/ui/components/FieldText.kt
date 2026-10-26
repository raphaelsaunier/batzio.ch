package ch.batzio.app.ui.components

import ch.batzio.app.core.FieldDef
import ch.batzio.app.core.Fmt
import ch.batzio.app.core.L
import ch.batzio.app.core.arr
import ch.batzio.app.core.bool
import ch.batzio.app.core.display
import ch.batzio.app.core.isNull
import ch.batzio.app.core.num
import ch.batzio.app.core.str
import kotlinx.serialization.json.JsonElement

typealias Labels = Map<String, Map<String, String>>

/** How a field's value reads on screen (same rules as the web cells). */
object FieldText {
    fun text(field: FieldDef, value: JsonElement?, labels: Labels = emptyMap()): String {
        if (value.isNull) return ""
        return when (field.type) {
            "money" -> Fmt.amount(value.num)
            "decimal" -> Fmt.number(value.num)
            "percent" -> Fmt.percent(value.num)
            "int" -> if (field.format == "duration") Fmt.duration(value.num) else value.str ?: ""
            "date" -> Fmt.date(value.str)
            "datetime" -> Fmt.dateTime(value.str)
            "boolean" -> if (value.bool == true) L("Yes") else L("No")
            "enum" -> field.option(value)?.label ?: value.display
            "ref" -> value.str?.let { labels[field.name]?.get(it) ?: "#$it" } ?: ""
            "tags" -> (value.arr ?: emptyList()).mapNotNull { it.str }.joinToString(", ") { labels[field.name]?.get(it) ?: "#$it" }
            "json" -> ""
            else -> value.display
        }
    }

    fun isEmpty(value: JsonElement?): Boolean = value.isNull || value.display.isEmpty() && value.arr.isNullOrEmpty() && value.num == null

    /** Fields grouped into form sections, in definition order. */
    fun sections(fields: List<FieldDef>): List<Pair<String?, List<FieldDef>>> {
        val out = linkedMapOf<String?, MutableList<FieldDef>>()
        for (f in fields) out.getOrPut(f.section) { mutableListOf() }.add(f)
        return out.map { it.key to it.value }
    }
}
