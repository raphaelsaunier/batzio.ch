package ch.batzio.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.Thunderstorm
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import ch.batzio.app.AppModel
import ch.batzio.app.BatziRoute
import ch.batzio.app.FileRoute
import ch.batzio.app.R
import ch.batzio.app.core.Fmt
import ch.batzio.app.core.L
import ch.batzio.app.core.MoneyWeather
import ch.batzio.app.core.Nudge
import ch.batzio.app.core.NudgeAction
import ch.batzio.app.core.QuickOutcome
import ch.batzio.app.core.QuickPlan
import ch.batzio.app.core.TodayScreen
import ch.batzio.app.core.UploadFile
import ch.batzio.app.core.obj
import ch.batzio.app.readUploads
import ch.batzio.app.ui.components.EmptyState
import ch.batzio.app.ui.components.Loader
import ch.batzio.app.ui.components.SectionTitle
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.NumberStyle
import ch.batzio.app.ui.theme.bzIcon
import ch.batzio.app.ui.theme.neuCard
import ch.batzio.app.ui.theme.toneColor
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import java.io.File

@Composable
fun TodayScreenView(app: AppModel) {
    Loader(app, "today", { it.get<TodayScreen>("/app/today") }) { today, refresh ->
        LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Image(painterResource(R.drawable.coin_front), null, Modifier.size(60.dp))
                    Spacer(Modifier.width(14.dp))
                    Column {
                        Text("${today.greeting}, ${today.name}", style = MaterialTheme.typography.headlineMedium)
                        Text(app.bootstrap?.tenant?.name ?: "", color = LocalBz.current.mutedForeground)
                    }
                }
            }
            item { QuickComposer(app) }
            today.weather?.let { w -> item { WeatherCard(w) } }
            if (today.nudges.isEmpty()) {
                item { EmptyState(L("All clear"), L("Nothing needs you right now. Go outside.")) }
            } else {
                item {
                    Column {
                        SectionTitle(L("Needs you"))
                        Text(L("Only what Batzi can’t decide for you."), color = LocalBz.current.mutedForeground, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                items(today.nudges, key = { it.key }) { NudgeCard(app, it, refresh) }
            }
            item { InboxCard(app) }
            if (today.threads.isNotEmpty()) item {
                Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    SectionTitle(L("Recent chats with Batzi"))
                    today.threads.take(5).forEach { t ->
                        Row(Modifier.fillMaxWidth().clickable { app.batzi.load(t.id); app.push(BatziRoute) }.padding(vertical = 6.dp)) {
                            Text(t.title, maxLines = 1, modifier = Modifier.weight(1f))
                            Text(Fmt.date(t.last), color = LocalBz.current.mutedForeground, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            item { Spacer(Modifier.height(80.dp)) }
        }
    }
}

/** Type what happened in plain words; Batzi shows what it would do. */
@Composable
fun QuickComposer(app: AppModel) {
    var text by remember { mutableStateOf("") }
    var plan by remember { mutableStateOf<QuickPlan?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(text) {
        val t = text.trim()
        if (t.length < 3) { plan = null; return@LaunchedEffect }
        delay(300)
        plan = runCatching { app.api.send<QuickPlan?>("POST", "/app/quick/plan", obj("text" to t)) }.getOrNull()
    }
    fun run(action: String) = scope.launch {
        busy = true
        try {
            val outcome: QuickOutcome = app.api.send("POST", "/app/quick/run", obj("text" to text, "actionId" to action))
            app.toast(outcome.message)
            text = ""; plan = null
            app.changed()
            outcome.record?.let { app.open(it) }
        } catch (e: Exception) { app.report(e) } finally { busy = false }
    }
    fun ask() { val t = text; text = ""; app.batzi.send(t); app.push(BatziRoute) }
    Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.AutoAwesome, null, tint = LocalBz.current.primary)
            TextField(
                text, { text = it },
                placeholder = { Text(L("Type a quick sentence: “invoice Muster AG 3h consulting at 180”")) },
                modifier = Modifier.weight(1f),
                colors = TextFieldDefaults.colors(focusedContainerColor = Color.Transparent, unfocusedContainerColor = Color.Transparent, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent),
            )
            if (text.isNotEmpty()) IconButton({ plan?.actions?.firstOrNull { it.primary == true }?.let { run(it.id) } ?: ask() }, enabled = !busy) {
                Icon(Icons.AutoMirrored.Outlined.Send, L("Send"), tint = LocalBz.current.primary)
            }
        }
        val p = plan
        if (p != null) {
            Text(p.headline, style = MaterialTheme.typography.titleMedium)
            p.details.forEach { Text("• $it", color = LocalBz.current.mutedForeground) }
            p.warnings.forEach { Text("⚠ $it", color = LocalBz.current.warning) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                p.actions.forEach { a -> NeuButton(a.label, { run(a.id) }, prominent = a.primary == true, compact = true, enabled = !busy) }
                if (app.bootstrap?.agent == true) NeuButton(L("Ask Batzi instead"), { ask() }, compact = true)
            }
        } else if (text.isEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                app.bootstrap?.examples.orEmpty().forEach { e -> NeuButton(e, { text = e }, compact = true) }
            }
        }
    }
}

@Composable
fun WeatherCard(w: MoneyWeather) {
    val t = LocalBz.current
    Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                SectionTitle(L("Money weather"))
                Text(Fmt.money(w.cash), style = MaterialTheme.typography.headlineLarge)
                Text(
                    when (w.mood) {
                        "sunny" -> L("Sunny: you are covered for the next 8 weeks.")
                        "cloudy" -> L("Cloudy: it gets tight around {date}.", "date" to Fmt.date(w.low.week))
                        else -> L("Rain ahead: money runs short around {date}.", "date" to Fmt.date(w.low.week))
                    },
                    color = t.mutedForeground,
                )
            }
            Icon(
                when (w.mood) { "sunny" -> Icons.Outlined.WbSunny; "cloudy" -> Icons.Outlined.Cloud; else -> Icons.Outlined.Thunderstorm },
                null, tint = if (w.mood == "sunny") t.sun else t.info, modifier = Modifier.size(44.dp),
            )
        }
        if (w.weeks.size > 1) {
            val values = w.weeks.map { it.balance }
            val lo = values.min(); val hi = values.max()
            val pad = maxOf((hi - lo) * 0.25, kotlin.math.abs(hi) * 0.02, 1.0)
            Canvas(Modifier.fillMaxWidth().height(110.dp)) {
                val min = lo - pad; val range = (hi + pad) - min
                val pts = values.mapIndexed { i, v -> Offset(size.width * i / (values.size - 1), size.height * (1 - ((v - min) / range).toFloat())) }
                val line = Path().apply { pts.forEachIndexed { i, p -> if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y) } }
                val area = Path().apply { addPath(line); lineTo(size.width, size.height); lineTo(0f, size.height); close() }
                drawPath(area, Brush.verticalGradient(listOf(t.primary.copy(alpha = 0.3f), t.primary.copy(alpha = 0.02f))))
                drawPath(line, t.primary, style = Stroke(width = 2.5.dp.toPx(), cap = StrokeCap.Round))
            }
        }
        Row(Modifier.fillMaxWidth()) {
            Text("+ ${Fmt.money(w.incoming)}", color = t.success, style = NumberStyle, modifier = Modifier.weight(1f))
            Text(L("8 weeks ahead"), color = t.mutedForeground, style = MaterialTheme.typography.bodySmall)
            Text("− ${Fmt.money(w.outgoing)}", color = t.destructive, style = NumberStyle, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.End)
        }
    }
}

@Composable
fun NudgeCard(app: AppModel, nudge: Nudge, refresh: () -> Unit) {
    val t = LocalBz.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    fun run(a: NudgeAction) = scope.launch {
        busy = true
        try {
            when (a.kind) {
                "link" -> a.target?.let { target -> if (target.kind == "file") app.push(FileRoute(target.id ?: 0)) else app.go(target) }
                "record_action" -> {
                    val r: ch.batzio.app.core.ActionResponse = app.api.send("POST", "/${a.resource}/${a.id}/${a.action}")
                    r.message?.let { app.toast(it) }
                    refresh()
                }
                "remind_overdue" -> {
                    val created: Int = app.api.send("POST", "/sales/reminders/run")
                    app.toast(L("Reminders created: {n}", "n" to created))
                    refresh()
                }
                "ask" -> { app.batzi.send(a.prompt ?: a.label); app.push(BatziRoute) }
                "process_inbox" -> { app.batzi.process(a.fileId, a.inboxId, a.prompt); app.push(BatziRoute) }
                "dismiss_inbox" -> { app.api.send<JsonElement>("PATCH", "/app/inbox/${a.inboxId}", obj("status" to "done")); refresh() }
            }
        } catch (e: Exception) { app.report(e) } finally { busy = false }
    }
    Row(Modifier.fillMaxWidth().neuCard(), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(38.dp).background(toneColor(t, if (nudge.tone == "danger") "danger" else nudge.tone).copy(alpha = 0.14f), CircleShape), contentAlignment = Alignment.Center) {
            Icon(bzIcon(nudge.icon), null, tint = toneColor(t, nudge.tone), modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(nudge.title, style = MaterialTheme.typography.titleSmall)
            nudge.text?.let { Text(it, color = t.mutedForeground, style = MaterialTheme.typography.bodyMedium) }
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                nudge.actions.filter { it.agent != true || app.bootstrap?.agent == true }.forEach { a ->
                    NeuButton(a.label, { run(a) }, prominent = a.primary == true, compact = true, enabled = !busy)
                }
            }
        }
        nudge.amount?.let { Text(Fmt.amount(it), style = NumberStyle) }
    }
}

@Composable
fun InboxCard(app: AppModel) {
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> app.drop(readUploads(context, uris)) }
    var photo by remember { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = photo
        if (ok && uri != null) app.drop(listOfNotNull(context.contentResolver.openInputStream(uri)?.use { UploadFile("scan-${Fmt.today()}.jpg", "image/jpeg", it.readBytes()) }))
    }
    Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionTitle(L("Inbox"))
        Text(L("Drop receipts, bills, bank statements or spreadsheets anywhere in Batzio, or forward them by email."), color = LocalBz.current.mutedForeground)
        app.bootstrap?.inbox?.let { address ->
            Text(address, style = MaterialTheme.typography.bodyMedium, maxLines = 1)
            val copy = ch.batzio.app.ui.components.rememberCopy()
            NeuButton(L("Copy"), { copy(address); app.toast(L("Copied")) }, compact = true)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NeuButton(L("Choose files"), { pick.launch(arrayOf("*/*")) })
            NeuButton(L("Scan"), {
                val dir = File(context.cacheDir, "camera").apply { mkdirs() }
                val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", File(dir, "scan.jpg"))
                photo = uri
                camera.launch(uri)
            })
        }
    }
}

