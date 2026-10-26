package ch.batzio.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.History
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ch.batzio.app.AppModel
import ch.batzio.app.BatziModel
import ch.batzio.app.core.L
import ch.batzio.app.core.ToolOutcome
import ch.batzio.app.readUploads
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.neuCard

@Composable
fun BatziScreen(app: AppModel) {
    val batzi = app.batzi
    val context = LocalContext.current
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris -> batzi.attach(readUploads(context, uris)) }
    var text by remember { mutableStateOf("") }
    var history by remember { mutableStateOf(false) }
    val list = rememberLazyListState()
    LaunchedEffect(Unit) { batzi.loadThreads() }
    LaunchedEffect(batzi.messages.size, batzi.messages.lastOrNull()?.text) { if (batzi.messages.isNotEmpty()) list.animateScrollToItem(batzi.messages.lastIndex + 1) }
    fun send() {
        val t = text.trim()
        if ((t.isEmpty() && batzi.attachments.isEmpty()) || batzi.working) return
        text = ""
        batzi.send(t)
    }
    Screen(app, "Batzi", actions = {
        IconButton({ history = true }) { Icon(Icons.Outlined.History, L("Recent")) }
        DropdownMenu(history, { history = false }) {
            DropdownMenuItem(text = { Text(L("New chat")) }, onClick = { batzi.reset(); history = false })
            batzi.threads.take(12).forEach { t -> DropdownMenuItem(text = { Text(t.title, maxLines = 1) }, onClick = { batzi.load(t.id); history = false }) }
        }
    }) {
        Column(Modifier.fillMaxSize().imePadding()) {
            if (batzi.working) LinearProgressIndicator(Modifier.fillMaxWidth())
            LazyColumn(Modifier.weight(1f), state = list, contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                item {
                    if (batzi.messages.isEmpty()) Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(L("Hi, I’m Batzi."), style = MaterialTheme.typography.headlineSmall)
                        Text(L("Tell me what happened, drop a receipt or ask about your numbers. I keep the books, you keep your sanity."), color = LocalBz.current.mutedForeground)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            app.bootstrap?.examples.orEmpty().forEach { e -> NeuButton(e, { text = e }, compact = true) }
                        }
                        if (app.bootstrap?.agent != true) Text(L("Batzi needs an Anthropic API key on the server before it can chat. Quick sentences and file drops still work."), color = LocalBz.current.warning)
                    }
                }
                items(batzi.messages, key = { it.id }) { MessageBubble(app, it) }
            }
            if (batzi.attachments.isNotEmpty()) Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                batzi.attachments.forEach { AssistChip(onClick = {}, label = { Text(it.name, maxLines = 1) }) }
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton({ pick.launch(arrayOf("*/*")) }) { Icon(Icons.Outlined.AttachFile, L("Choose files")) }
                OutlinedTextField(text, { text = it }, placeholder = { Text(L("Ask Batzi anything…")) }, modifier = Modifier.weight(1f), maxLines = 6)
                IconButton(::send, enabled = !batzi.working) { Icon(Icons.AutoMirrored.Outlined.Send, L("Send"), tint = LocalBz.current.primary) }
            }
        }
    }
}

@Composable
private fun MessageBubble(app: AppModel, m: BatziModel.Message) {
    val t = LocalBz.current
    val mine = m.role == "user"
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (m.streaming && m.updates.isNotEmpty()) Text(m.updates.last(), style = MaterialTheme.typography.bodySmall, color = t.mutedForeground)
        m.files.forEach { Text("📎 ${it.name}", style = MaterialTheme.typography.bodySmall, color = t.mutedForeground) }
        if (m.text.isNotEmpty()) Text(
            m.text,
            modifier = Modifier.widthIn(max = 560.dp).background(if (mine) t.primary.copy(alpha = 0.14f) else t.card, RoundedCornerShape(16.dp)).padding(horizontal = 14.dp, vertical = 10.dp),
        )
        m.tools.forEach { ToolCard(app, it) }
        if (m.refused) Text(L("Batzi declined this one."), style = MaterialTheme.typography.bodySmall, color = t.mutedForeground)
    }
}

@Composable
private fun ToolCard(app: AppModel, tool: ToolOutcome) {
    val t = LocalBz.current
    Column(Modifier.widthIn(max = 560.dp).neuCard(radius = 14.dp, padding = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text((if (tool.pending == true) "✋ " else if (tool.ok) "✓ " else "✕ ") + tool.title, style = MaterialTheme.typography.titleSmall, color = if (tool.pending == true) t.warning else if (tool.ok) t.success else t.destructive)
        tool.summary?.let { Text(it, color = t.mutedForeground, style = MaterialTheme.typography.bodySmall) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            tool.record?.let { r -> NeuButton(r.label ?: L("Open"), { app.open(r) }, compact = true) }
            if (tool.pending == true) {
                NeuButton(L("Yes, do it"), { app.batzi.confirm(tool, true) }, prominent = true, compact = true)
                NeuButton(L("No"), { app.batzi.confirm(tool, false) }, compact = true)
            }
        }
    }
}
