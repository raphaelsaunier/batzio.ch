package ch.batzio.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ch.batzio.app.AppModel
import ch.batzio.app.core.AppTarget
import ch.batzio.app.core.BankImportResult
import ch.batzio.app.core.L
import ch.batzio.app.core.PayrollResult
import ch.batzio.app.core.obj
import ch.batzio.app.readUploads
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.neuCard
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.Month
import java.time.format.TextStyle

/** Imports camt.053/054 or CSV bank statements. */
@Composable
fun BankImportScreen(app: AppModel) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var autoBook by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<BankImportResult?>(null) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        val file = uri?.let { readUploads(context, listOf(it)).firstOrNull() } ?: return@rememberLauncherForActivityResult
        scope.launch {
            busy = true
            try {
                result = app.api.sendRaw("/banking/import", file.bytes, if (file.name.lowercase().endsWith(".xml")) "application/xml" else "text/csv", mapOf("auto_book" to "$autoBook"))
                app.changed()
            } catch (e: Exception) { app.report(e) } finally { busy = false }
        }
    }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(L("Bank statements"), style = MaterialTheme.typography.headlineSmall)
            Text(L("Import camt.053/054 files from your e-banking or a simple CSV. Batzio skips duplicates and matches payments to open invoices."), color = LocalBz.current.mutedForeground)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(L("Book exact QR-reference matches automatically"), Modifier.weight(1f))
                Switch(autoBook, { autoBook = it })
            }
            NeuButton(L("Choose statement…"), { pick.launch(arrayOf("*/*")) }, prominent = true, enabled = !busy)
            Text(L("Tip: you can also just drop the file anywhere in Batzio."), style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
        }
        result?.let { r ->
            Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(L("Imported {n} transactions", "n" to r.imported), style = MaterialTheme.typography.titleLarge)
                Text(L("{d} duplicates skipped · {s} matches suggested · {b} booked", "d" to r.duplicates, "s" to r.suggested, "b" to r.booked), color = LocalBz.current.mutedForeground)
                NeuButton(L("Review transactions"), { app.go(AppTarget("resource", resource = "bank_transactions")) })
            }
        }
    }
}

/** Creates the month's payslips for every active employee. */
@Composable
fun PayrollScreen(app: AppModel) {
    val scope = rememberCoroutineScope()
    var year by remember { mutableIntStateOf(LocalDate.now().year) }
    var month by remember { mutableIntStateOf(LocalDate.now().monthValue) }
    var busy by remember { mutableStateOf(false) }
    var done by remember { mutableStateOf<String?>(null) }
    Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) {
        Column(Modifier.widthIn(max = 760.dp).fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(L("Payroll run"), style = MaterialTheme.typography.headlineSmall)
            Text(L("Creates draft payslips with AHV/IV/EO, ALV, BVG, accident and daily-allowance insurance for everyone employed that month. Check them, then finalise."), color = LocalBz.current.mutedForeground)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                NeuButton("‹", { if (month == 1) { month = 12; year-- } else month-- }, compact = true)
                Text("${Month.of(month).getDisplayName(TextStyle.FULL, ch.batzio.app.core.I18n.formattingLocale)} $year", style = MaterialTheme.typography.titleMedium)
                NeuButton("›", { if (month == 12) { month = 1; year++ } else month++ }, compact = true)
            }
            NeuButton(L("Run payroll"), {
                scope.launch {
                    busy = true
                    try {
                        val r: PayrollResult = app.api.send("POST", "/payroll/run", obj("year" to year, "month" to month))
                        done = L("{n} payslips ready for review.", "n" to r.created)
                        app.changed()
                    } catch (e: Exception) { app.report(e) } finally { busy = false }
                }
            }, prominent = true, enabled = !busy)
            done?.let {
                Text(it, style = MaterialTheme.typography.titleMedium)
                NeuButton(L("Open payslips"), { app.go(AppTarget("resource", resource = "payslips")) })
            }
        }
    }
}
