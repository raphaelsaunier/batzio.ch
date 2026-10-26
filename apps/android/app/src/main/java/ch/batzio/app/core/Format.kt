package ch.batzio.app.core

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.abs

/** Swiss number, money and date formatting, matching the web (1’234.50). */
object Fmt {
    private val zurich = ZoneId.of("Europe/Zurich")

    private fun pattern(digits: Int): DecimalFormat {
        val symbols = DecimalFormatSymbols().apply {
            groupingSeparator = '’'
            decimalSeparator = '.'
            minusSign = '-'
        }
        return DecimalFormat(if (digits == 0) "#,##0" else "#,##0." + "0".repeat(digits), symbols)
    }

    fun amount(value: Double?, digits: Int = 2): String = value?.let { pattern(digits).format(it) } ?: ""
    fun money(value: Double?, currency: String = "CHF"): String = value?.let { "$currency ${amount(it)}" } ?: ""
    fun number(value: Double?): String = when {
        value == null -> ""
        value == Math.rint(value) -> amount(value, 0)
        abs(value * 100 - Math.rint(value * 100)) < 1e-9 -> amount(value, 2)
        else -> amount(value, 4)
    }
    fun percent(value: Double?): String = value?.let { "${number(it)} %" } ?: ""

    fun parseDate(iso: String?): LocalDate? = iso?.takeIf { it.length >= 10 }?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
    fun date(iso: String?): String = parseDate(iso)?.format(DateTimeFormatter.ofPattern("dd.MM.yyyy")) ?: (iso ?: "")
    fun dateTime(iso: String?): String {
        if (iso == null) return ""
        val instant = runCatching { Instant.parse(iso) }.getOrNull() ?: return date(iso)
        return DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm").withZone(zurich).format(instant)
    }
    fun duration(minutes: Double?): String = minutes?.let { val m = Math.round(it).toInt(); "${m / 60}:${"%02d".format(m % 60)} h" } ?: ""
    fun bytes(size: Long): String = when {
        size < 1024 -> "$size B"
        size < 1024 * 1024 -> "${size / 1024} KB"
        else -> "%.1f MB".format(size / 1024.0 / 1024.0)
    }
    fun today(): String = LocalDate.now(zurich).toString()
}
