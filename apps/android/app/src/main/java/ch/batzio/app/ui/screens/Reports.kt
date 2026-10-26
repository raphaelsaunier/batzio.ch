package ch.batzio.app.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.batzio.app.AppModel
import ch.batzio.app.RecordRoute
import ch.batzio.app.ReportRoute
import ch.batzio.app.core.Fmt
import ch.batzio.app.core.L
import ch.batzio.app.core.ReportScreen
import ch.batzio.app.core.ReportTable
import ch.batzio.app.core.display
import ch.batzio.app.core.num
import ch.batzio.app.core.str
import ch.batzio.app.ui.components.Loader
import ch.batzio.app.ui.components.RefPicker
import ch.batzio.app.ui.components.SectionTitle
import ch.batzio.app.ui.components.TermLabel
import ch.batzio.app.ui.components.rememberOpener
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.NumberStyle
import ch.batzio.app.ui.theme.bzIcon
import ch.batzio.app.ui.theme.neuCard
import ch.batzio.app.ui.theme.toneColor
import java.time.LocalDate

@Composable
fun ReportsScreen(app: AppModel) {
    LazyVerticalGrid(GridCells.Adaptive(280.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(app.bootstrap?.reports.orEmpty(), key = { it.id }) { r ->
            Column(Modifier.fillMaxWidth().neuCard().clickable { app.push(ReportRoute(r.id)) }, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(bzIcon(r.icon), null, tint = LocalBz.current.primary)
                Text(r.title, style = MaterialTheme.typography.titleLarge)
                Text(r.text, color = LocalBz.current.mutedForeground, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
fun ReportScreenView(app: AppModel, id: String) {
    val info = app.bootstrap?.reports?.firstOrNull { it.id == id }
    Screen(app, info?.title ?: id) { ReportBody(app, id) }
}

@Composable
fun ReportBody(app: AppModel, id: String) {
    val info = app.bootstrap?.reports?.firstOrNull { it.id == id }
    val year = LocalDate.now().year
    var from by remember { mutableStateOf("$year-01-01") }
    var to by remember { mutableStateOf("$year-12-31") }
    var date by remember { mutableStateOf(LocalDate.now().toString()) }
    var y by remember { mutableIntStateOf(year) }
    var account by remember { mutableStateOf<Pair<Int, String>?>(null) }
    var picking by remember { mutableStateOf(false) }
    val opener = rememberOpener(app, LocalContext.current)
    val query: Map<String, String?> = when (info?.params) {
        "date" -> mapOf("date" to date)
        "period" -> mapOf("from" to from, "to" to to)
        "ledger" -> mapOf("from" to from, "to" to to, "account_id" to account?.first?.toString())
        "year" -> mapOf("year" to "$y")
        else -> emptyMap()
    }
    Loader(app, "report/$id/$query", { it.get<ReportScreen>("/app/reports/$id", query) }) { report, _ ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (info?.params) {
                    "year" -> { NeuButton("‹", { y-- }, compact = true); Text("$y", Modifier.align(Alignment.CenterVertically)); NeuButton("›", { y++ }, compact = true) }
                    "date" -> listOf(0L, 30L, 90L).forEach { back -> val d = LocalDate.now().minusDays(back).toString(); NeuButton(Fmt.date(d), { date = d }, compact = true, prominent = date == d) }
                    "period", "ledger" -> {
                        listOf(year, year - 1).forEach { yy -> NeuButton("$yy", { from = "$yy-01-01"; to = "$yy-12-31" }, compact = true, prominent = from == "$yy-01-01" && to == "$yy-12-31") }
                        if (info.params == "ledger") NeuButton(account?.second ?: L("Choose account"), { picking = true }, compact = true)
                    }
                }
                report.pdf?.let { pdf -> NeuButton("PDF", { opener(pdf, query + ("format" to "pdf")) }, compact = true) }
                NeuButton("Excel", { opener("/app/reports/$id", query + ("format" to "xlsx")) }, compact = true)
            }
            Text(report.subtitle, color = LocalBz.current.mutedForeground)
            if (report.balanced == false) Text(L("Assets and liabilities do not balance yet."), color = LocalBz.current.warning)
            if (report.summary.isNotEmpty()) FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                report.summary.forEach { s ->
                    Column(Modifier.neuCard(radius = 16.dp, padding = 14.dp)) {
                        Text(s.label, style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
                        Text(Fmt.amount(s.value), style = MaterialTheme.typography.headlineSmall, color = if (s.tone != null) toneColor(LocalBz.current, s.tone) else MaterialTheme.colorScheme.onBackground)
                    }
                }
            }
            report.tables.forEach { ReportTableCard(app, it) }
            Spacer(Modifier.height(40.dp))
        }
    }
    if (picking) RefPicker(app, "accounts", emptyMap(), allowsNone = false, onDismiss = { picking = false }) { o -> o?.let { account = it.id to it.label } }
}

/** Label on the left, the figures on the right: reads well on phones and tablets. */
@Composable
private fun ReportTableCard(app: AppModel, table: ReportTable) {
    val numeric = table.columns.indices.filter { table.columns[it].isNumeric }
    val texts = table.columns.indices.filter { !table.columns[it].isNumeric }
    Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        table.title?.let { Text(it, style = MaterialTheme.typography.titleLarge) }
        Row { texts.firstOrNull()?.let { TermLabel(app, table.columns[it].label, table.columns[it].term) } }
        table.rows.forEach { row ->
            val bold = row.style == "total" || row.style == "section"
            fun cell(i: Int): String {
                val v = row.cells.getOrNull(i)
                return when (table.columns[i].type) {
                    "money" -> v.num?.let { Fmt.amount(it) } ?: ""
                    "number" -> v.num?.let { Fmt.number(it) } ?: ""
                    "date" -> v.str?.let { Fmt.date(it) } ?: ""
                    else -> v.display
                }
            }
            Row(
                Modifier.fillMaxWidth().clickable(enabled = row.link != null) { row.link?.let { app.push(RecordRoute(it.resource, it.id)) } }.padding(vertical = 6.dp, horizontal = ((row.indent ?: 0) * 10).dp),
                verticalAlignment = Alignment.Top,
            ) {
                Text(
                    texts.map(::cell).filter { it.isNotEmpty() }.joinToString(" · "),
                    modifier = Modifier.weight(1f),
                    fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal,
                    color = if (row.style == "muted") LocalBz.current.mutedForeground else if (row.link != null) LocalBz.current.primary else MaterialTheme.colorScheme.onBackground,
                )
                Column(horizontalAlignment = Alignment.End) {
                    numeric.forEach { i ->
                        val v = cell(i)
                        if (v.isNotEmpty()) Row {
                            if (numeric.size > 1) Text(table.columns[i].label + "  ", style = MaterialTheme.typography.labelSmall, color = LocalBz.current.mutedForeground)
                            Text(v, style = NumberStyle, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal)
                        }
                    }
                }
            }
            if (row.style == "total") HorizontalDivider()
        }
    }
}
