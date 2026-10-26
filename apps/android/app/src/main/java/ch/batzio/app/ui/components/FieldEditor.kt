package ch.batzio.app.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.AssistChip
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.IconButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import ch.batzio.app.AppModel
import ch.batzio.app.core.FieldDef
import ch.batzio.app.core.Fmt
import ch.batzio.app.core.L
import ch.batzio.app.core.RefOption
import ch.batzio.app.core.arr
import ch.batzio.app.core.bool
import ch.batzio.app.core.display
import ch.batzio.app.core.int
import ch.batzio.app.core.isNull
import ch.batzio.app.core.num
import ch.batzio.app.core.str
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/** The right control for a field type, bound to a JSON value. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FieldEditor(app: AppModel, field: FieldDef, value: JsonElement?, onChange: (JsonElement) -> Unit, labels: Map<String, String> = emptyMap(), error: String? = null, enabled: Boolean = true) {
    val label = field.label + if (field.required == true) " *" else ""
    val support: (@Composable () -> Unit)? = (error ?: field.description)?.let { { Text(it) } }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        when (field.type) {
            "boolean" -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                TermLabel(app, label, field.term, Modifier.weight(1f))
                Switch(checked = value.bool == true, onCheckedChange = { onChange(JsonPrimitive(it)) }, enabled = enabled)
            }
            "enum" -> {
                var open by remember { mutableStateOf(false) }
                ExposedDropdownMenuBox(expanded = open, onExpandedChange = { if (enabled) open = it }) {
                    OutlinedTextField(
                        value = field.option(value)?.label ?: "",
                        onValueChange = {},
                        readOnly = true,
                        label = { Text(label) },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) },
                        modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
                        enabled = enabled,
                        isError = error != null,
                        supportingText = support,
                    )
                    ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                        if (field.required != true) DropdownMenuItem(text = { Text("—") }, onClick = { onChange(JsonNull); open = false })
                        field.options.orEmpty().forEach { o -> DropdownMenuItem(text = { Text(o.label) }, onClick = { onChange(JsonPrimitive(o.value)); open = false }) }
                    }
                }
            }
            "date", "datetime" -> DateField(field, label, value, onChange, enabled, support)
            "ref" -> RefField(app, field, label, value, onChange, labels, enabled, support)
            "tags" -> TagsField(app, field, label, value, onChange, labels)
            "json" -> Unit
            "int", "decimal", "money", "percent" -> {
                var text by remember(field.name) { mutableStateOf(numberText(field, value)) }
                LaunchedEffect(value) { if (parse(text) != value.num) text = numberText(field, value) }
                OutlinedTextField(
                    value = text,
                    onValueChange = { t -> text = t; if (t.isBlank()) onChange(JsonNull) else parse(t)?.let { onChange(JsonPrimitive(it)) } },
                    label = { Text(label) },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(textAlign = TextAlign.End),
                    modifier = Modifier.fillMaxWidth(),
                    enabled = enabled,
                    isError = error != null,
                    supportingText = support,
                    singleLine = true,
                )
            }
            else -> OutlinedTextField(
                value = value.display,
                onValueChange = { onChange(if (it.isEmpty()) JsonNull else JsonPrimitive(it)) },
                label = { Text(label) },
                placeholder = field.placeholder?.let { { Text(it) } },
                keyboardOptions = KeyboardOptions(keyboardType = when (field.type) { "email" -> KeyboardType.Email; "url" -> KeyboardType.Uri; "phone" -> KeyboardType.Phone; else -> KeyboardType.Text }),
                modifier = Modifier.fillMaxWidth(),
                singleLine = field.type != "text",
                minLines = if (field.type == "text") 3 else 1,
                enabled = enabled,
                isError = error != null,
                supportingText = support,
            )
        }
    }
}

private fun parse(s: String): Double? = s.replace("’", "").replace("'", "").replace(",", ".").replace(" ", "").toDoubleOrNull()
private fun numberText(field: FieldDef, v: JsonElement?): String {
    val d = v.num ?: return ""
    return if (field.type == "money") "%.2f".format(d) else if (d == Math.rint(d)) d.toLong().toString() else d.toString()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DateField(field: FieldDef, label: String, value: JsonElement?, onChange: (JsonElement) -> Unit, enabled: Boolean, support: (@Composable () -> Unit)?) {
    var open by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = Fmt.date(value.str),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            modifier = Modifier.weight(1f),
            enabled = enabled,
            supportingText = support,
            trailingIcon = if (!value.isNull && field.required != true) ({ IconButton({ onChange(JsonNull) }) { Icon(Icons.Outlined.Close, null) } }) else null,
        )
        NeuButton(L("Set date"), { open = true }, compact = true, enabled = enabled, modifier = Modifier.padding(start = 8.dp))
    }
    if (open) {
        val initial = Fmt.parseDate(value.str) ?: LocalDate.now()
        val state = rememberDatePickerState(initialSelectedDateMillis = initial.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { open = false },
            confirmButton = {
                TextButton({
                    state.selectedDateMillis?.let { onChange(JsonPrimitive(Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString())) }
                    open = false
                }) { Text("OK") }
            },
            dismissButton = { TextButton({ open = false }) { Text(L("Cancel")) } },
        ) { DatePicker(state) }
    }
}

@Composable
private fun RefField(app: AppModel, field: FieldDef, label: String, value: JsonElement?, onChange: (JsonElement) -> Unit, labels: Map<String, String>, enabled: Boolean, support: (@Composable () -> Unit)?) {
    var picking by remember { mutableStateOf(false) }
    var chosen by remember { mutableStateOf<String?>(null) }
    val text = chosen ?: value.str?.let { labels[it] ?: "#$it" } ?: ""
    Box {
        OutlinedTextField(
            value = text,
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(label) },
            placeholder = { Text(L("Choose…")) },
            supportingText = support,
            modifier = Modifier.fillMaxWidth(),
        )
        // Tapping anywhere on the field opens the picker.
        Box(Modifier.matchParentSize().clickable(enabled = enabled) { picking = true })
    }
    if (picking) {
        RefPicker(app, field.ref ?: "", field.refFilter.orEmpty(), allowsNone = field.required != true, onDismiss = { picking = false }) { o ->
            onChange(o?.let { JsonPrimitive(it.id) } ?: JsonNull)
            chosen = o?.label
        }
    }
}

@Composable
private fun TagsField(app: AppModel, field: FieldDef, label: String, value: JsonElement?, onChange: (JsonElement) -> Unit, labels: Map<String, String>) {
    var picking by remember { mutableStateOf(false) }
    val known = remember { mutableMapOf<String, String>() }
    val ids = value.arr.orEmpty().mapNotNull { it.int }
    Column {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = LocalBz.current.mutedForeground)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            ids.forEach { id ->
                AssistChip(onClick = { onChange(JsonArray(ids.filter { it != id }.map { JsonPrimitive(it) })) }, label = { Text(known["$id"] ?: labels["$id"] ?: "#$id") }, trailingIcon = { Icon(Icons.Outlined.Close, null) })
            }
            NeuButton("+", { picking = true }, compact = true)
        }
    }
    if (picking) RefPicker(app, field.ref ?: "", field.refFilter.orEmpty(), allowsNone = false, onDismiss = { picking = false }) { o ->
        if (o != null && o.id !in ids) {
            known["${o.id}"] = o.label
            onChange(JsonArray((ids + o.id).map { JsonPrimitive(it) }))
        }
    }
}

/** Picks a referenced record (contact, account, VAT code…). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefPicker(app: AppModel, resource: String, filter: Map<String, JsonElement>, allowsNone: Boolean, onDismiss: () -> Unit, onPick: (RefOption?) -> Unit) {
    var query by remember { mutableStateOf("") }
    var options by remember { mutableStateOf<List<RefOption>>(emptyList()) }
    LaunchedEffect(query) {
        if (query.isNotEmpty()) delay(200)
        options = runCatching { app.api.get<List<RefOption>>("/app/options/$resource", mapOf("q" to query) + filter.mapValues { it.value.str }) }.getOrDefault(emptyList())
    }
    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Scaffold(topBar = {
            TopAppBar(
                title = { Text(app.bootstrap?.resource(resource)?.labelPlural ?: resource) },
                navigationIcon = { IconButton(onDismiss) { Icon(Icons.Outlined.Close, L("Close")) } },
            )
        }) { padding ->
            Column(Modifier.padding(padding).fillMaxSize()) {
                OutlinedTextField(query, { query = it }, placeholder = { Text(L("Search")) }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(16.dp))
                LazyColumn(Modifier.fillMaxSize()) {
                    if (allowsNone) item {
                        Text(L("None"), color = LocalBz.current.mutedForeground, modifier = Modifier.fillMaxWidth().clickable { onPick(null); onDismiss() }.padding(16.dp))
                        HorizontalDivider()
                    }
                    items(options, key = { it.id }) { o ->
                        Text(o.label, modifier = Modifier.fillMaxWidth().clickable { onPick(o); onDismiss() }.padding(16.dp))
                        HorizontalDivider()
                    }
                    if (options.isEmpty()) item { Text(L("Nothing found"), color = LocalBz.current.mutedForeground, modifier = Modifier.padding(16.dp)) }
                }
            }
        }
    }
}

