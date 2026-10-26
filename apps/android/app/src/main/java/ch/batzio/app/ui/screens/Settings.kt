package ch.batzio.app.ui.screens

import android.graphics.Bitmap
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ch.batzio.app.AppModel
import ch.batzio.app.ListRoute
import ch.batzio.app.SettingsPage
import ch.batzio.app.core.ApiKeyInfo
import ch.batzio.app.core.CreatedApiKey
import ch.batzio.app.core.InviteResult
import ch.batzio.app.core.L
import ch.batzio.app.ui.components.rememberCopy
import ch.batzio.app.core.MessageResult
import ch.batzio.app.core.NumberFormat
import ch.batzio.app.core.SettingsScreen
import ch.batzio.app.core.TeamScreen
import ch.batzio.app.core.obj
import ch.batzio.app.ui.components.EmptyState
import ch.batzio.app.ui.components.FieldEditor
import ch.batzio.app.ui.components.Loader
import ch.batzio.app.ui.components.SectionTitle
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.neuCard
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.File

@Composable
private fun SettingsRow(title: String, subtitle: String? = null, onClick: () -> Unit) {
    Column(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 12.dp)) {
        Text(title)
        subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground) }
    }
}

@Composable
fun SettingsScreenView(app: AppModel) {
    val copy = rememberCopy()
    val scope = rememberCoroutineScope()
    Loader(app, "settings", { it.get<SettingsScreen>("/app/settings") }) { s, refresh ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.fillMaxWidth().neuCard()) {
                SectionTitle(L("You"))
                app.prefs.user?.let { Text("${it.name} · ${it.email}", modifier = Modifier.padding(vertical = 8.dp)) }
                Choice(L("Language"), listOf("" to L("Same as device"), "en" to "English", "de" to "Deutsch", "fr" to "Français", "it" to "Italiano"), app.prefs.locale ?: "") { app.setLocale(it.ifEmpty { null }) }
                Choice(L("Appearance"), listOf("system" to L("System"), "light" to L("Light"), "dark" to L("Dark")), app.prefs.appearance) { v -> app.update { it.copy(appearance = v) } }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(L("Accountant goggles"))
                        Text(L("Classic terms, every module"), style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
                    }
                    Switch(app.isAccountant, { app.setMode(if (it) "accountant" else "simple") })
                }
                if (app.prefs.companies.size > 1) Choice(L("Company"), app.prefs.companies.map { it.slug to it.name }, app.tenantSlug) { slug -> app.prefs.companies.firstOrNull { it.slug == slug }?.let(app::choose) }
                if (app.isOnDevice) {
                    var confirming by remember { mutableStateOf(false) }
                    TextButton({ app.signOut() }) { Text(L("Sign out")) }
                    TextButton({ confirming = true }) { Text(L("Delete everything on this device…"), color = LocalBz.current.destructive) }
                    if (confirming) AlertDialog(
                        onDismissRequest = { confirming = false },
                        title = { Text(L("Delete everything on this device…")) },
                        text = { Text(L("This deletes every company, document and file stored on this device. It cannot be undone.")) },
                        confirmButton = { TextButton({ confirming = false; app.deleteEverythingOnDevice() }) { Text(L("Delete everything"), color = LocalBz.current.destructive) } },
                        dismissButton = { TextButton({ confirming = false }) { Text(L("Cancel")) } },
                    )
                } else {
                    TextButton({ app.signOut() }) { Text(L("Sign out"), color = LocalBz.current.destructive) }
                }
            }
            Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SectionTitle(L("Batzi & inbox"))
                Text(L("Everything here can also be set up by talking to Batzi or dropping a file."), style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
                s.inbox?.let { inbox ->
                    Text(inbox)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        NeuButton(L("Copy"), { copy(inbox); app.toast(L("Copied")) }, compact = true)
                        if (s.canWrite) NeuButton(L("Get a new address"), {
                            scope.launch {
                                try { app.api.send<JsonElement>("POST", "/app/inbox-address"); app.toast(L("New address ready. The old one no longer works.")); refresh(); app.reload() } catch (e: Exception) { app.report(e) }
                            }
                        }, compact = true)
                    }
                }
                Text("Batzi: " + when {
                    s.agent -> L("Ready")
                    app.isOnDevice -> L("Needs an internet connection")
                    else -> L("Needs an Anthropic API key on the server")
                }, color = LocalBz.current.mutedForeground)
            }
            Column(Modifier.fillMaxWidth().neuCard()) {
                SectionTitle(L("Company"))
                SettingsRow(L("Company profile")) { app.push(SettingsPage("company")) }
                SettingsRow(L("Accounting")) { app.push(SettingsPage("accounting")) }
                SettingsRow(L("Document texts")) { app.push(SettingsPage("texts")) }
                SettingsRow(L("Number formats")) { app.push(SettingsPage("numbering")) }
                // On this device there is nobody to invite and nothing to connect to.
                if (!app.isOnDevice) {
                    if (app.bootstrap?.can("users") == true) SettingsRow(L("Users & roles")) { app.push(SettingsPage("team")) }
                    SettingsRow(L("API & MCP")) { app.push(SettingsPage("api")) }
                }
            }
            Column(Modifier.fillMaxWidth().neuCard()) {
                SectionTitle(L("Master data"))
                app.bootstrap?.resources.orEmpty().filter { it.nav?.group == "settings" }.sortedBy { it.nav?.order ?: 0 }.forEach { r ->
                    SettingsRow(r.labelPlural, r.description) { app.push(ListRoute(r.name)) }
                }
                if (app.bootstrap?.resource("audit_log") != null) SettingsRow(L("Audit log")) { app.push(ListRoute("audit_log")) }
            }
            Text(
                if (app.isOnDevice) "${L("On this device")}: ${app.deviceFolder.path}" else "${L("Server")}: ${app.prefs.serverUrl}",
                style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground,
            )
            Spacer(Modifier.height(40.dp))
        }
    }
}

@Composable
private fun Choice(title: String, options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().clickable { open = true }.padding(vertical = 12.dp)) {
        Text(title, Modifier.weight(1f))
        Box {
            Text(options.firstOrNull { it.first == selected }?.second ?: "", color = LocalBz.current.primary)
            DropdownMenu(open, { open = false }) { options.forEach { (v, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { open = false; onPick(v) }) } }
        }
    }
}

@Composable
fun SettingsPageScreen(app: AppModel, page: String) {
    val title = when (page) {
        "company" -> L("Company profile"); "accounting" -> L("Accounting"); "texts" -> L("Document texts")
        "numbering" -> L("Number formats"); "team" -> L("Users & roles"); else -> L("API & MCP")
    }
    Screen(app, title) {
        when (page) {
            "company", "accounting", "texts" -> SettingsFormPage(app, page)
            "numbering" -> NumberingPage(app)
            "team" -> TeamPage(app)
            else -> ApiKeysPage(app)
        }
    }
}

@Composable
private fun SettingsFormPage(app: AppModel, group: String) {
    val scope = rememberCoroutineScope()
    Loader(app, "settings/$group", { it.get<SettingsScreen>("/app/settings") }) { s, _ ->
        val form = when (group) { "company" -> s.forms.company; "accounting" -> s.forms.accounting; else -> s.forms.texts }
        val values = remember(form) { mutableStateMapOf<String, JsonElement>().apply { putAll(form.values) } }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            Column(Modifier.fillMaxWidth().neuCard()) {
                form.fields.forEach { f -> FieldEditor(app, f, values[f.name], { values[f.name] = it }, enabled = s.canWrite) }
                if (s.canWrite) NeuButton(L("Save"), {
                    scope.launch {
                        try {
                            val r: MessageResult = app.api.send("PATCH", "/app/settings/$group", JsonObject(values.toMap()))
                            app.toast(r.message); app.reload(); app.pop()
                        } catch (e: Exception) { app.report(e) }
                    }
                }, prominent = true, modifier = Modifier.padding(top = 12.dp))
            }
        }
    }
}

@Composable
private fun NumberingPage(app: AppModel) {
    var editing by remember { mutableStateOf<NumberFormat?>(null) }
    val scope = rememberCoroutineScope()
    Loader(app, "numbering", { it.get<SettingsScreen>("/app/settings") }) { s, refresh ->
        LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp)) {
            items(s.numbering, key = { it.key }) { f ->
                Row(Modifier.fillMaxWidth().clickable(enabled = s.canWrite) { editing = f }.padding(vertical = 12.dp)) {
                    Column(Modifier.weight(1f)) { Text(f.label); Text(f.format, style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground) }
                    Text(f.preview, color = LocalBz.current.primary)
                }
                HorizontalDivider()
            }
        }
        editing?.let { f ->
            var pattern by remember(f) { mutableStateOf(f.format) }
            var next by remember(f) { mutableStateOf(f.next_value.toString()) }
            AlertDialog(
                onDismissRequest = { editing = null },
                title = { Text(f.label) },
                text = {
                    Column {
                        OutlinedTextField(pattern, { pattern = it }, label = { Text(L("Format")) }, singleLine = true)
                        OutlinedTextField(next, { next = it }, label = { Text(L("Next number: {nr}", "nr" to next)) }, singleLine = true)
                        Text(L("Use {YYYY}, {YY}, {MM} and #### for the counter."), style = MaterialTheme.typography.bodySmall)
                    }
                },
                confirmButton = {
                    TextButton({
                        scope.launch {
                            try {
                                val r: MessageResult = app.api.send("PATCH", "/app/numbering/${f.key}", obj("format" to pattern, "next_value" to (next.toIntOrNull() ?: 1)))
                                app.toast(r.message); editing = null; refresh()
                            } catch (e: Exception) { app.report(e) }
                        }
                    }) { Text(L("Save")) }
                },
                dismissButton = { TextButton({ editing = null }) { Text(L("Cancel")) } },
            )
        }
    }
}

private val ROLES = listOf("owner", "admin", "accountant", "member", "viewer")
private fun roleLabel(role: String) = when (role) {
    "owner" -> L("Owner"); "admin" -> L("Administrator"); "accountant" -> L("Accountant"); "member" -> L("Member"); else -> L("Viewer")
}

@Composable
private fun TeamPage(app: AppModel) {
    val scope = rememberCoroutineScope()
    val copy = rememberCopy()
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("member") }
    var link by remember { mutableStateOf<String?>(null) }
    Loader(app, "team", { it.get<TeamScreen>("/app/team") }) { team, refresh ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.fillMaxWidth().neuCard()) {
                SectionTitle(L("Members"))
                team.members.forEach { m ->
                    var menu by remember { mutableStateOf(false) }
                    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(m.name); Text(m.email, style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground) }
                        Box {
                            TextButton({ menu = true }, enabled = team.canWrite && m.user_id != team.me) { Text(roleLabel(m.role)) }
                            DropdownMenu(menu, { menu = false }) {
                                ROLES.forEach { r -> DropdownMenuItem(text = { Text(roleLabel(r)) }, onClick = {
                                    menu = false
                                    scope.launch { try { app.api.send<JsonElement>("PATCH", "/app/team/${m.user_id}", obj("role" to r)); app.toast(L("Role updated.")); refresh() } catch (e: Exception) { app.report(e) } }
                                }) }
                                HorizontalDivider()
                                DropdownMenuItem(text = { Text(L("Remove"), color = LocalBz.current.destructive) }, onClick = {
                                    menu = false
                                    scope.launch { try { app.api.send<JsonElement>("DELETE", "/app/team/${m.user_id}"); app.toast(L("Member removed.")); refresh() } catch (e: Exception) { app.report(e) } }
                                })
                            }
                        }
                    }
                }
                if (team.invitations.isNotEmpty()) {
                    SectionTitle(L("Invitations"), Modifier.padding(top = 12.dp))
                    team.invitations.forEach { Text("${it.email} · ${roleLabel(it.role)}", modifier = Modifier.padding(vertical = 6.dp)) }
                }
            }
            if (team.canWrite) Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionTitle(L("Invite"))
                OutlinedTextField(email, { email = it }, label = { Text(L("Email")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Choice(L("Role"), ROLES.map { it to roleLabel(it) }, role) { role = it }
                NeuButton(L("Invite"), {
                    scope.launch {
                        try {
                            val r: InviteResult = app.api.send("POST", "/app/team", obj("email" to email, "role" to role))
                            app.toast(r.message); link = r.link; email = ""; refresh()
                        } catch (e: Exception) { app.report(e) }
                    }
                }, prominent = true, enabled = "@" in email)
                link?.let { l ->
                    Text(L("Share this link with your colleague"), style = MaterialTheme.typography.bodySmall)
                    Text(l)
                    NeuButton(L("Copy"), { copy(l); app.toast(L("Copied")) }, compact = true)
                }
            }
        }
    }
}

@Composable
private fun ApiKeysPage(app: AppModel) {
    val scope = rememberCoroutineScope()
    val copy = rememberCopy()
    var name by remember { mutableStateOf("") }
    var write by remember { mutableStateOf(false) }
    var created by remember { mutableStateOf<String?>(null) }
    Loader(app, "api-keys", { it.get<List<ApiKeyInfo>>("/app/api-keys") }) { keys, refresh ->
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(L("Connect scripts, other software and AI assistants (MCP) with an API key."), color = LocalBz.current.mutedForeground)
                Text("MCP: ${app.prefs.serverUrl}/api/mcp", style = MaterialTheme.typography.bodySmall)
                keys.forEach { k ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(k.name); Text("${k.prefix}… · ${k.scope} · ${k.user_name}", style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground) }
                        if (k.revoked_at != null) Text(L("Revoked"), color = LocalBz.current.mutedForeground)
                        else NeuButton(L("Revoke"), {
                            scope.launch { try { app.api.send<JsonElement>("DELETE", "/app/api-keys/${k.id}"); app.toast(L("API key revoked.")); refresh() } catch (e: Exception) { app.report(e) } }
                        }, compact = true)
                    }
                }
            }
            Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                SectionTitle(L("New API key"))
                OutlinedTextField(name, { name = it }, label = { Text(L("Name")) }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(verticalAlignment = Alignment.CenterVertically) { Text(L("Allow changes (not just reading)"), Modifier.weight(1f)); Switch(write, { write = it }) }
                NeuButton(L("Create"), {
                    scope.launch {
                        try {
                            val r: CreatedApiKey = app.api.send("POST", "/app/api-keys", obj("name" to name, "scope" to if (write) "write" else "read", "role" to (app.bootstrap?.role ?: "viewer")))
                            created = r.key; name = ""; refresh()
                        } catch (e: Exception) { app.report(e) }
                    }
                }, prominent = true)
                created?.let { key ->
                    Text(L("API key created. Copy it now — it will not be shown again."), color = LocalBz.current.warning)
                    Text(key)
                    NeuButton(L("Copy"), { copy(key); app.toast(L("Copied")) }, compact = true)
                }
            }
        }
    }
}

/** Shows an attachment: PDFs render in place, anything else opens in a viewer app. */
@Composable
fun FileScreen(app: AppModel, id: Int, name: String?) {
    val context = LocalContext.current
    var pages by remember { mutableStateOf<List<Bitmap>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(id) {
        try {
            val d = app.api.download("/files/$id/download", mapOf("inline" to "1"))
            if (d.mimeType.startsWith("application/pdf")) {
                pages = withContext(Dispatchers.IO) {
                    val file = File(context.cacheDir, "downloads/view-$id.pdf").apply { parentFile?.mkdirs(); writeBytes(d.bytes) }
                    PdfRenderer(ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)).use { r ->
                        (0 until r.pageCount).map { i ->
                            r.openPage(i).use { p ->
                                Bitmap.createBitmap(p.width * 2, p.height * 2, Bitmap.Config.ARGB_8888).also { b ->
                                    b.eraseColor(android.graphics.Color.WHITE)
                                    p.render(b, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                }
                            }
                        }
                    }
                }
            } else {
                ch.batzio.app.ui.components.openFile(context, d.bytes, d.filename, d.mimeType.substringBefore(';'))
                pages = emptyList()
            }
        } catch (e: Exception) { error = e.message }
    }
    Screen(app, name ?: L("File")) {
        when {
            error != null -> EmptyState(L("Something went wrong"), error)
            pages == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
            pages!!.isEmpty() -> EmptyState(name ?: L("File"))
            else -> LazyColumn(Modifier.background(Color(0xFF8A8F98)), contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(pages!!) { Image(it.asImageBitmap(), null, Modifier.fillMaxWidth(), contentScale = ContentScale.FillWidth) }
            }
        }
    }
}
