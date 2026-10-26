package ch.batzio.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.OpenableColumns
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.content.IntentCompat
import ch.batzio.app.core.UploadFile
import ch.batzio.app.ui.screens.Root
import ch.batzio.app.ui.theme.BatzioTheme

class MainActivity : ComponentActivity() {
    private val model: AppModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            BatzioTheme(model.prefs.appearance) { Root(model) }
        }
        if (savedInstanceState == null) {
            model.debugLaunch(intent.extras)
            handle(intent)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        model.debugLaunch(intent.extras)
        handle(intent)
    }

    /** Files shared to Batzio (or opened with it) go straight to the inbox. */
    private fun handle(intent: Intent?) {
        val uris: List<Uri> = when (intent?.action) {
            Intent.ACTION_SEND -> listOfNotNull(IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java))
            Intent.ACTION_SEND_MULTIPLE -> IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            Intent.ACTION_VIEW -> listOfNotNull(intent.data)
            else -> emptyList()
        }
        if (uris.isNotEmpty()) model.drop(readUploads(this, uris))
    }
}

fun readUploads(context: android.content.Context, uris: List<Uri>): List<UploadFile> = uris.mapNotNull { uri ->
    val resolver = context.contentResolver
    val name = resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    } ?: uri.lastPathSegment ?: "upload"
    val bytes = resolver.openInputStream(uri)?.use { it.readBytes() } ?: return@mapNotNull null
    UploadFile(name, resolver.getType(uri) ?: "application/octet-stream", bytes)
}
