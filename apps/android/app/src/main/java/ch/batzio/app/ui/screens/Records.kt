package ch.batzio.app.ui.screens

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.FilterList
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import ch.batzio.app.AppModel
import ch.batzio.app.BatziRoute
import ch.batzio.app.FileRoute
import ch.batzio.app.FormRoute
import ch.batzio.app.RecordRoute
import ch.batzio.app.core.ActionDef
import ch.batzio.app.core.ActionResponse
import ch.batzio.app.core.BzJson
import ch.batzio.app.core.ChildDef
import ch.batzio.app.core.DocumentTotals
import ch.batzio.app.core.FieldDef
import ch.batzio.app.core.Fmt
import ch.batzio.app.core.ItemDefaults
import ch.batzio.app.core.L
import ch.batzio.app.core.NavTab
import ch.batzio.app.core.NewRecord
import ch.batzio.app.core.RecordList
import ch.batzio.app.core.RecordScreen
import ch.batzio.app.core.ResourceSchema
import ch.batzio.app.core.ApiException
import ch.batzio.app.core.arr
import ch.batzio.app.core.int
import ch.batzio.app.core.num
import ch.batzio.app.core.obj
import ch.batzio.app.core.str
import ch.batzio.app.readUploads
import ch.batzio.app.ui.components.EmptyState
import ch.batzio.app.ui.components.FieldEditor
import ch.batzio.app.ui.components.FieldText
import ch.batzio.app.ui.components.Labels
import ch.batzio.app.ui.components.Loader
import ch.batzio.app.ui.components.SectionTitle
import ch.batzio.app.ui.components.StatusBadge
import ch.batzio.app.ui.components.TermLabel
import ch.batzio.app.ui.components.rememberOpener
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.NumberStyle
import ch.batzio.app.ui.theme.bzIcon
import ch.batzio.app.ui.theme.neuCard
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

@Composable
fun ResourceListScreen(app: AppModel, resource: String) {
    val res = app.bootstrap?.resource(resource)
    Screen(app, res?.labelPlural ?: resource) { ResourceListBody(app, resource, emptyList()) }
}

/** Any module's list: search, status filter, paging, totals, export. */
@Composable
fun ResourceListBody(app: AppModel, initial: String, tabs: List<NavTab>) {
    var current by remember(initial) { mutableStateOf(initial) }
    val res = app.bootstrap?.resource(current) ?: return EmptyState(L("This module is not available to your role."))
    var query by remember { mutableStateOf("") }
    var status by remember(current) { mutableStateOf<String?>(null) }
    val rows = remember(current) { mutableStateListOf<JsonObject>() }
    val labels = remember(current) { mutableStateMapOf<String, Map<String, String>>() }
    val titles = remember(current) { mutableStateMapOf<String, String>() }
    var total by remember(current) { mutableStateOf(0) }
    var totals by remember(current) { mutableStateOf<Map<String, Double>>(emptyMap()) }
    var loading by remember { mutableStateOf(false) }
    var filterOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val opener = rememberOpener(app, LocalContext.current)
    fun params() = buildMap<String, String?> {
        put("limit", "40")
        if (query.isNotBlank()) put("q", query)
        status?.let { s -> res.statusField?.let { put(it, s) } }
    }
    suspend fun load(reset: Boolean) {
        loading = true
        try {
            val page: RecordList = app.api.get("/app/records/${res.name}", params() + ("offset" to if (reset) "0" else rows.size.toString()))
            if (reset) { rows.clear(); labels.clear(); titles.clear() }
            rows.addAll(page.rows); labels.putAll(page.labels); titles.putAll(page.titles)
            total = page.total; totals = page.totals
        } catch (e: Exception) { app.report(e) } finally { loading = false }
    }
    LaunchedEffect(current, query, status, app.revision) { if (query.isNotEmpty()) delay(250); load(true) }
    val resourceTabs = tabs.filter { it.target.kind == "resource" && it.target.id == null && it.target.create != true }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (resourceTabs.size > 1) item {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    resourceTabs.forEach { tab -> NeuButton(tab.title, { current = tab.target.resource!! }, prominent = current == tab.target.resource, compact = true) }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(query, { query = it }, placeholder = { Text(L("Search")) }, singleLine = true, modifier = Modifier.weight(1f))
                    Box {
                        IconButton({ filterOpen = true }) { Icon(Icons.Outlined.FilterList, L("Filter")) }
                        DropdownMenu(filterOpen, { filterOpen = false }) {
                            res.statusDef?.options?.let { options ->
                                DropdownMenuItem(text = { Text(L("All")) }, onClick = { status = null; filterOpen = false })
                                options.forEach { o -> DropdownMenuItem(text = { Text(o.label) }, onClick = { status = o.value; filterOpen = false }) }
                                HorizontalDivider()
                            }
                            DropdownMenuItem(text = { Text(L("Export to Excel")) }, onClick = { filterOpen = false; opener("/${res.name}", params() + ("format" to "xlsx") + ("limit" to null)) })
                        }
                    }
                }
            }
            res.listFields.firstOrNull { it.type == "money" }?.let { money ->
                totals[money.name]?.let { sum -> item {
                    Row(Modifier.fillMaxWidth()) {
                        Text(L("{n} records", "n" to total), color = LocalBz.current.mutedForeground, modifier = Modifier.weight(1f))
                        Text("${money.label}: ${Fmt.money(sum)}", style = NumberStyle)
                    }
                } }
            }
            itemsIndexed(rows, key = { _, r -> r["id"].int ?: 0 }) { i, row ->
                if (i == rows.lastIndex && rows.size < total && !loading) LaunchedEffect(rows.size) { load(false) }
                RecordRow(res, row, titles[row["id"].str ?: ""], labels) { app.push(RecordRoute(res.name, row["id"].int ?: 0)) }
            }
            if (loading) item { Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
            if (!loading && rows.isEmpty()) item {
                val empty = res.empty
                if (empty != null && query.isEmpty() && status == null) EmptyState(empty.title, empty.text) else EmptyState(L("Nothing found"))
            }
        }
        if (res.canCreate) FloatingActionButton({ app.push(FormRoute(res.name)) }, Modifier.align(Alignment.BottomEnd).padding(20.dp)) { Icon(Icons.Outlined.Add, res.label) }
    }
}

@Composable
private fun RecordRow(res: ResourceSchema, row: JsonObject, title: String?, labels: Labels, onClick: () -> Unit) {
    val money = res.listFields.firstOrNull { it.type == "money" }
    val details = res.listFields.filter { it.name != money?.name && it.name != res.statusField && it.type != "boolean" }.take(3)
    Row(Modifier.fillMaxWidth().neuCard(radius = 16.dp, padding = 14.dp).clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title ?: "#${row["id"].str}", style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val text = details.map { FieldText.text(it, row[it.name], labels) }.filter { it.isNotEmpty() && it != title }.joinToString(" · ")
            if (text.isNotEmpty()) Text(text, style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            money?.let { Text(FieldText.text(it, row[it.name]), style = NumberStyle) }
            StatusBadge(res.statusDef, row[res.statusField ?: ""])
        }
    }
}

@Composable
fun RecordScreenView(app: AppModel, resource: String, id: Int) {
    val res = app.bootstrap?.resource(resource)
    var title by remember { mutableStateOf(res?.label ?: "") }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var canEdit by remember { mutableStateOf(false) }
    var canDelete by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Screen(app, title, actions = {
        if (canEdit) IconButton({ app.push(FormRoute(resource, id)) }) { Icon(Icons.Outlined.Edit, L("Edit")) }
        Box {
            IconButton({ menu = true }) { Icon(Icons.Outlined.MoreVert, L("More")) }
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text(L("Ask Batzi about this")) }, onClick = { menu = false; app.batzi.send(L("About {label} {title}: ", "label" to (res?.label ?: ""), "title" to title)); app.push(BatziRoute) })
                if (canDelete && res != null) DropdownMenuItem(text = { Text(if (res.softDelete) L("Archive") else L("Delete")) }, leadingIcon = { Icon(Icons.Outlined.Delete, null) }, onClick = { menu = false; confirmDelete = true })
            }
        }
    }) {
        if (res == null) return@Screen EmptyState(L("This module is not available to your role."))
        Loader(app, "$resource/$id", { it.get<RecordScreen>("/app/records/$resource/$id", mapOf("mode" to it.mode)) }) { screen, refresh ->
            LaunchedEffect(screen) { title = screen.title; canEdit = screen.canEdit && !res.readOnly; canDelete = screen.canDelete }
            RecordDetail(app, res, id, screen, refresh)
        }
        if (confirmDelete) AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(if (res.softDelete) L("Archive this record?") else L("Delete this record?")) },
            confirmButton = {
                TextButton({
                    confirmDelete = false
                    scope.launch {
                        try {
                            app.api.send<JsonElement>("DELETE", "/$resource/$id")
                            app.toast(if (res.softDelete) L("Archived") else L("Deleted"))
                            app.changed(); app.pop()
                        } catch (e: Exception) { app.report(e) }
                    }
                }) { Text(if (res.softDelete) L("Archive") else L("Delete")) }
            },
            dismissButton = { TextButton({ confirmDelete = false }) { Text(L("Cancel")) } },
        )
    }
}

@Composable
private fun RecordDetail(app: AppModel, res: ResourceSchema, id: Int, screen: RecordScreen, refresh: () -> Unit) {
    val record = screen.record
    val context = LocalContext.current
    val opener = rememberOpener(app, context)
    val scope = rememberCoroutineScope()
    val attach = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        scope.launch {
            readUploads(context, uris).forEach { f ->
                runCatching { app.api.upload<JsonElement>("/files/upload", listOf(f), fileField = "file", fields = mapOf("ref_type" to res.name, "ref_id" to "$id")) }.onFailure { app.report(it) }
            }
            refresh()
        }
    }
    val visible = res.fields.filter { it.hidden != true && it.type != "json" && it.name != "id" && !FieldText.isEmpty(record[it.name]) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(screen.title, style = MaterialTheme.typography.headlineMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(res.label, color = LocalBz.current.mutedForeground)
                StatusBadge(res.statusDef, record[res.statusField ?: ""])
            }
            val figures = res.fields.filter { it.type == "money" && it.list == true && !FieldText.isEmpty(record[it.name]) }.take(3)
            if (figures.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                figures.forEach { f -> Column { TermLabel(app, f.label, f.term); Text(Fmt.amount(record[f.name].num), style = MaterialTheme.typography.headlineSmall) } }
            }
            screen.locked?.let { Text("🔒 $it", style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground) }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            screen.pdf?.let { pdf -> NeuButton("PDF", { opener(pdf, emptyMap()) }) }
            screen.actions.forEachIndexed { i, name -> res.action(name)?.let { ActionButton(app, res, id, it, primary = i == 0) { refresh() } } }
        }
        FieldText.sections(visible).forEach { (section, fields) ->
            Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                section?.let { SectionTitle(it) }
                fields.forEach { f ->
                    if (f.type == "text") {
                        TermLabel(app, f.label, f.term)
                        Text(FieldText.text(f, record[f.name], screen.labels))
                    } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        TermLabel(app, f.label, f.term, Modifier.weight(1f))
                        when {
                            f.name == res.statusField -> StatusBadge(f, record[f.name])
                            f.type == "ref" && f.ref != null && record[f.name].int != null -> Text(
                                FieldText.text(f, record[f.name], screen.labels), color = LocalBz.current.primary,
                                modifier = Modifier.clickable { app.push(RecordRoute(f.ref, record[f.name].int!!)) },
                            )
                            else -> Text(FieldText.text(f, record[f.name], screen.labels), style = if (f.type == "money") NumberStyle else MaterialTheme.typography.bodyMedium)
                        }
                    }
                }
            }
        }
        res.children.forEach { child ->
            val rows = record[child.name].arr.orEmpty().mapNotNull { it as? JsonObject }
            if (rows.isNotEmpty()) ChildTable(child, rows, screen.labels)
        }
        screen.related.filter { it.total > 0 }.forEach { rel ->
            Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                SectionTitle("${rel.label} (${rel.total})")
                rel.rows.forEach { r ->
                    Row(Modifier.fillMaxWidth().clickable { app.push(RecordRoute(rel.resource, r.id)) }.padding(vertical = 6.dp)) {
                        Text(r.title, modifier = Modifier.weight(1f))
                        StatusBadge(app.bootstrap?.resource(rel.resource)?.statusDef, r.status)
                    }
                }
            }
        }
        Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                SectionTitle(L("Attachments"), Modifier.weight(1f))
                NeuButton("+", { attach.launch(arrayOf("*/*")) }, compact = true)
            }
            screen.files.forEach { f ->
                Row(Modifier.fillMaxWidth().clickable { app.push(FileRoute(f.id, f.name)) }.padding(vertical = 6.dp)) {
                    Text("📎 ${f.name}", modifier = Modifier.weight(1f), maxLines = 1)
                    Text(Fmt.bytes(f.size), style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
                }
            }
            if (screen.files.isEmpty()) Text(L("Drop receipts or documents here to keep them with this record."), style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
        }
        if (screen.history.isNotEmpty()) Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SectionTitle(L("History"))
            screen.history.forEach { h ->
                Text(h.summary ?: h.action)
                Text("${h.actor_name ?: ""} · ${Fmt.dateTime(h.at)}", style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
            }
        }
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
private fun ChildTable(child: ChildDef, rows: List<JsonObject>, labels: Labels) {
    val shown = child.fields.filter { f -> f.hidden != true && f.type != "json" && f.name !in listOf("id", "sort") && rows.any { !FieldText.isEmpty(it[f.name]) } }.take(6)
    Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionTitle(child.label)
        rows.forEach { row ->
            Column(Modifier.fillMaxWidth()) {
                val main = shown.firstOrNull { it.type == "string" || it.type == "text" }
                Text(main?.let { FieldText.text(it, row[it.name], labels.childLabels(child, it)) } ?: "", maxLines = 2)
                Text(
                    shown.filter { it != main }.map { FieldText.text(it, row[it.name], labels.childLabels(child, it)) }.filter { it.isNotEmpty() }.joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground,
                )
            }
            HorizontalDivider()
        }
    }
}

private fun Labels.childLabels(child: ChildDef, f: FieldDef): Labels = this["${child.name}.${f.name}"]?.let { mapOf(f.name to it) } ?: emptyMap()

/** A workflow step on a record (issue, record payment, book…), with confirmation or inputs. */
@Composable
fun ActionButton(app: AppModel, res: ResourceSchema, id: Int, action: ActionDef, primary: Boolean, done: () -> Unit) {
    var confirming by remember { mutableStateOf(false) }
    var inputting by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun run(input: Map<String, JsonElement>) = scope.launch {
        busy = true
        try {
            val r: ActionResponse = app.api.send("POST", "/${res.name}/$id/${action.name}", JsonObject(input))
            r.message?.let { app.toast(it) }
            app.changed()
            r.redirect?.let { app.push(RecordRoute(it.resource, it.id)) } ?: done()
        } catch (e: Exception) { app.report(e) } finally { busy = false }
    }
    NeuButton(action.label, {
        when {
            !action.input.isNullOrEmpty() -> inputting = true
            action.confirm != null -> confirming = true
            else -> run(emptyMap())
        }
    }, prominent = primary && action.variant != "destructive", enabled = !busy, leading = action.icon?.let { { Icon(bzIcon(it), null, Modifier.padding(0.dp)) } })
    if (confirming) AlertDialog(
        onDismissRequest = { confirming = false },
        title = { Text(action.confirm ?: action.label) },
        text = { Text(action.description) },
        confirmButton = { TextButton({ confirming = false; run(emptyMap()) }) { Text(action.label) } },
        dismissButton = { TextButton({ confirming = false }) { Text(L("Cancel")) } },
    )
    if (inputting) {
        val values = remember { mutableStateMapOf<String, JsonElement>().apply {
            action.input.orEmpty().forEach { f -> (f.default ?: if (f.type == "date") JsonPrimitive(Fmt.today()) else null)?.let { put(f.name, it) } }
        } }
        Dialog({ inputting = false }) {
            Column(Modifier.neuCard().widthIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(action.label, style = MaterialTheme.typography.titleLarge)
                Text(action.description, color = LocalBz.current.mutedForeground)
                action.input.orEmpty().forEach { f -> FieldEditor(app, f, values[f.name], { values[f.name] = it }) }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton({ inputting = false }) { Text(L("Cancel")) }
                    NeuButton(action.label, { inputting = false; run(values.toMap()) }, prominent = true)
                }
            }
        }
    }
}

/** Creates or edits any record from its definition; documents get positions and live totals. */
@Composable
fun RecordFormScreen(app: AppModel, resource: String, id: Int?, prefill: String?) {
    val res = app.bootstrap?.resource(resource)
    val values = remember { mutableStateMapOf<String, JsonElement>() }
    var labels by remember { mutableStateOf<Labels>(emptyMap()) }
    var errors by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
    var message by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var totals by remember { mutableStateOf<DocumentTotals?>(null) }
    val scope = rememberCoroutineScope()
    val title = if (id == null) L("New {label}", "label" to (res?.label ?: "")) else L("Edit {label}", "label" to (res?.label ?: ""))
    LaunchedEffect(resource, id) {
        try {
            if (id != null) {
                val s: RecordScreen = app.api.get("/app/records/$resource/$id")
                values.putAll(s.record); labels = s.labels
            } else {
                val fresh: NewRecord = app.api.get("/app/records/$resource/new")
                values.putAll(fresh.values)
                prefill?.let { values.putAll(BzJson.decodeFromString<JsonObject>(it)) }
            }
        } catch (e: Exception) { message = e.message }
        loaded = true
    }
    if (res?.isDocument == true) LaunchedEffect(values["positions"], values["vat_mode"], values["currency_code"]) {
        if (!loaded) return@LaunchedEffect
        delay(250)
        totals = runCatching {
            app.api.send<DocumentTotals>("POST", "/app/documents/totals", obj("positions" to (values["positions"] ?: JsonArray(emptyList())), "vat_mode" to (values["vat_mode"] ?: JsonPrimitive("excl")), "currency_code" to (values["currency_code"] ?: JsonPrimitive("CHF"))))
        }.getOrNull()
    }
    val editable = res?.fields.orEmpty().filter { it.isEditable && !(id != null && it.createOnly == true) && it.name != "id" }
    fun save() = scope.launch {
        res ?: return@launch
        saving = true
        val payload = JsonObject(editable.mapNotNull { f -> values[f.name]?.let { f.name to it } }.toMap() + res.children.mapNotNull { c -> values[c.name]?.let { c.name to it } })
        try {
            val saved: JsonObject = if (id != null) app.api.send("PATCH", "/${res.name}/$id", payload) else app.api.send("POST", "/${res.name}", payload)
            app.toast(L("Saved."))
            app.changed()
            app.pop()
            if (id == null) saved["id"].int?.let { app.push(RecordRoute(res.name, it)) }
        } catch (e: ApiException) { errors = e.fields; message = e.message } catch (e: Exception) { message = e.message } finally { saving = false }
    }
    Screen(app, title, actions = { TextButton(::save, enabled = !saving && loaded) { Text(L("Save")) } }) {
        if (res == null) return@Screen EmptyState(L("This module is not available to your role."))
        if (!loaded) return@Screen Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            message?.let { Text(it, color = LocalBz.current.destructive) }
            FieldText.sections(editable).forEach { (section, fields) ->
                Column(Modifier.fillMaxWidth().neuCard()) {
                    section?.let { SectionTitle(it) }
                    fields.forEach { f -> FieldEditor(app, f, values[f.name], { values[f.name] = it }, labels[f.name].orEmpty(), errors[f.name]) }
                }
            }
            res.children.forEach { child ->
                ChildrenEditor(app, child, values[child.name].arr.orEmpty().mapNotNull { it as? JsonObject }, labels, totals?.takeIf { child.name == "positions" }, purchase = res.name in listOf("purchase_orders", "bills")) {
                    values[child.name] = JsonArray(it)
                }
            }
            totals?.let { t ->
                Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SectionTitle(L("Totals"))
                    Row { Text(L("Net"), Modifier.weight(1f)); Text(Fmt.amount(t.total_net), style = NumberStyle) }
                    t.vat.forEach { v -> Row { Text(L("VAT {rate}%", "rate" to Fmt.number(v.rate)), Modifier.weight(1f)); Text(Fmt.amount(v.vat), style = NumberStyle) } }
                    if (t.rounding != 0.0) Row { Text(L("Rounding"), Modifier.weight(1f)); Text(Fmt.amount(t.rounding), style = NumberStyle) }
                    Row { Text(L("Total"), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium); Text(Fmt.money(t.total, values["currency_code"].str ?: "CHF"), style = MaterialTheme.typography.titleMedium) }
                }
            }
            Spacer(Modifier.height(60.dp))
        }
    }
}

/** Positions and other child rows: add, edit, remove. */
@Composable
private fun ChildrenEditor(app: AppModel, child: ChildDef, rows: List<JsonObject>, labels: Labels, totals: DocumentTotals?, purchase: Boolean, onChange: (List<JsonObject>) -> Unit) {
    var editing by remember { mutableStateOf<Int?>(null) }
    var adding by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val typeField = child.fields.firstOrNull { it.name == "type" && it.type == "enum" }
    val editable = child.fields.filter { it.isEditable && it.name !in listOf("id", "sort") }
    fun add(type: String?) {
        val row = buildMap<String, JsonElement> {
            editable.forEach { f -> f.default?.let { put(f.name, it) } }
            type?.let { put("type", JsonPrimitive(it)) }
            if (child.fields.any { it.name == "quantity" } && "quantity" !in this) put("quantity", JsonPrimitive(1))
        }
        onChange(rows + JsonObject(row))
        editing = rows.size
    }
    Column(Modifier.fillMaxWidth().neuCard(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionTitle(child.label)
        rows.forEachIndexed { i, row ->
            Row(Modifier.fillMaxWidth().clickable { editing = i }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    val main = (row["text"] ?: row["description"] ?: row["name"]).str ?: row["type"].str ?: "#${i + 1}"
                    Text(main.lineSequence().first(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val q = row["quantity"].num; val p = row["unit_price"].num
                    if (q != null && p != null) Text("${Fmt.number(q)} × ${Fmt.amount(p)}", style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground)
                    else row["amount"].num?.let { Text(Fmt.amount(it), style = MaterialTheme.typography.bodySmall, color = LocalBz.current.mutedForeground) }
                }
                totals?.lines?.getOrNull(i)?.let { Text(Fmt.amount(it.subtotal ?: it.total), style = NumberStyle) }
                IconButton({ onChange(rows.filterIndexed { j, _ -> j != i }) }) { Icon(Icons.Outlined.Delete, L("Delete")) }
            }
            HorizontalDivider()
        }
        Box {
            NeuButton(L("Add {label}", "label" to child.label), { if (typeField?.options != null) adding = true else add(null) }, compact = true)
            DropdownMenu(adding, { adding = false }) {
                typeField?.options.orEmpty().forEach { o -> DropdownMenuItem(text = { Text(o.label) }, onClick = { adding = false; add(o.value) }) }
            }
        }
    }
    editing?.let { index ->
        val row = rows.getOrNull(index) ?: return@let
        Dialog({ editing = null }) {
            Column(Modifier.neuCard().widthIn(max = 560.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(child.label, style = MaterialTheme.typography.titleLarge)
                editable.forEach { f ->
                    FieldEditor(app, f, row[f.name], { v ->
                        var next = row + (f.name to v)
                        onChange(rows.toMutableList().also { it[index] = JsonObject(next) })
                        if (f.name == "item_id" && v.int != null) scope.launch {
                            runCatching { app.api.get<ItemDefaults>("/app/items/${v.int}/defaults", mapOf("purchase" to if (purchase) "1" else null)) }.getOrNull()?.let { d ->
                                next = next + mapOf("text" to JsonPrimitive(d.text), "unit_price" to JsonPrimitive(d.unit_price)) +
                                    listOfNotNull(d.unit_name?.let { "unit_name" to JsonPrimitive(it) }, d.tax_id?.let { "tax_id" to JsonPrimitive(it) }) +
                                    (if (next["type"].str == null || next["type"].str == "custom") mapOf("type" to JsonPrimitive("item")) else emptyMap())
                                onChange(rows.toMutableList().also { it[index] = JsonObject(next) })
                            }
                        }
                    }, labels["${child.name}.${f.name}"].orEmpty())
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { NeuButton(L("Done"), { editing = null }, prominent = true) }
            }
        }
    }
}

