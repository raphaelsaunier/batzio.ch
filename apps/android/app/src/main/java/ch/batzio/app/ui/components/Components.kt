package ch.batzio.app.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import ch.batzio.app.AppModel
import ch.batzio.app.R
import ch.batzio.app.core.Api
import ch.batzio.app.core.FieldDef
import ch.batzio.app.core.L
import ch.batzio.app.ui.theme.LocalBz
import ch.batzio.app.ui.theme.NeuButton
import ch.batzio.app.ui.theme.ToneBadge
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import java.io.File

/** Loads a value and shows loading, error and content states; reloads when the app changes. */
@Composable
fun <T> Loader(app: AppModel, key: Any, load: suspend (Api) -> T, content: @Composable (T, refresh: () -> Unit) -> Unit) {
    var value by remember(key) { mutableStateOf<T?>(null) }
    var error by remember(key) { mutableStateOf<String?>(null) }
    var nonce by remember { mutableStateOf(0) }
    LaunchedEffect(key, app.revision, app.locale, nonce) {
        try {
            value = load(app.api)
            error = null
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (value == null) error = e.message else app.report(e)
        }
    }
    val current = value
    when {
        current != null -> content(current) { nonce++ }
        error != null -> ErrorState(error!!) { nonce++ }
        else -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    }
}

/** The coin mascot with a message, for empty and error states. */
@Composable
fun EmptyState(title: String, text: String? = null, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Image(painterResource(R.drawable.coin_front), contentDescription = null, modifier = Modifier.size(72.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, textAlign = TextAlign.Center)
        if (text != null) Text(text, style = MaterialTheme.typography.bodyMedium, color = LocalBz.current.mutedForeground, textAlign = TextAlign.Center, modifier = Modifier.widthIn(max = 440.dp))
    }
}

@Composable
fun ErrorState(message: String, retry: (() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        EmptyState(L("Something went wrong"), message)
        if (retry != null) NeuButton(L("Try again"), retry)
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, color = LocalBz.current.mutedForeground, modifier = modifier)
}

/** A label with a jargon explanation when the term is in the glossary. */
@Composable
fun TermLabel(app: AppModel, text: String, term: String?, modifier: Modifier = Modifier) {
    val entry = app.bootstrap?.explain(term)
    var open by remember { mutableStateOf(false) }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.bodyMedium, color = LocalBz.current.mutedForeground)
        if (entry != null) {
            IconButton(onClick = { open = true }, modifier = Modifier.size(28.dp)) {
                Icon(Icons.AutoMirrored.Outlined.HelpOutline, contentDescription = L("What does this mean?"), modifier = Modifier.size(16.dp), tint = LocalBz.current.mutedForeground)
            }
        }
    }
    if (open && entry != null) {
        AlertDialog(onDismissRequest = { open = false }, confirmButton = { TextButton({ open = false }) { Text(L("Close")) } }, title = { Text(entry.term) }, text = { Text(entry.text) })
    }
}

@Composable
fun StatusBadge(field: FieldDef?, value: JsonElement?) {
    val option = field?.option(value) ?: return
    ToneBadge(option.label, option.tone)
}

/** Downloads a server file (PDF, XLSX, attachment) and hands it to a viewer app. */
@Composable
fun rememberOpener(app: AppModel, context: Context): (path: String, query: Map<String, String?>) -> Unit {
    val scope = rememberCoroutineScope()
    return { path, query ->
        scope.launch {
            try {
                val d = app.api.download(path, query)
                openFile(context, d.bytes, d.filename, d.mimeType.substringBefore(';'))
            } catch (e: Exception) {
                app.report(e)
            }
        }
    }
}

fun openFile(context: Context, bytes: ByteArray, name: String, mime: String) {
    val dir = File(context.cacheDir, "downloads").apply { mkdirs() }
    val file = File(dir, name.replace('/', '-')).apply { writeBytes(bytes) }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    try {
        context.startActivity(Intent.createChooser(view, name))
    } catch (_: ActivityNotFoundException) {
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), name))
    }
}
