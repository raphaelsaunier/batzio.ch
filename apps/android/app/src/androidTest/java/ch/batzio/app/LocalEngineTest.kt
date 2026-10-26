package ch.batzio.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import ch.batzio.app.core.Api
import ch.batzio.app.core.ApiException
import ch.batzio.app.core.AuthResult
import ch.batzio.app.core.Bootstrap
import ch.batzio.app.core.I18n
import ch.batzio.app.core.LocalEngine
import ch.batzio.app.core.RecordList
import ch.batzio.app.core.UploadFile
import ch.batzio.app.core.int
import ch.batzio.app.core.obj
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * The on-device mode end to end: the real engine bundle in a hidden WebView,
 * SQLite files in app storage, and the app's own API client on top.
 */
@RunWith(AndroidJUnit4::class)
class LocalEngineTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test
    fun runsTheWholeAppOnTheDevice() = runBlocking {
        LocalEngine.shutdown()
        LocalEngine.defaultDirectory(context).deleteRecursively()
        I18n.load(context)
        LocalEngine.get(context)

        val auth: AuthResult = Api(LocalEngine.ORIGIN, locale = "de").send(
            "POST", "/auth/signup",
            obj("name" to "Anna Muster", "email" to "anna@device.local", "password" to "on-this-device-only", "company" to "Muster GmbH", "language" to "de", "demo" to true),
        )
        assertEquals(listOf("muster-gmbh"), auth.companies.map { it.slug })
        val api = Api(LocalEngine.ORIGIN, auth.token, "muster-gmbh", "de")

        val boot: Bootstrap = api.get("/app/bootstrap", mapOf("mode" to "simple"))
        assertEquals("Heute", boot.navigation.first().items.first().title)
        val list: RecordList = api.get("/app/records/invoices", mapOf("limit" to "5"))
        assertTrue(list.rows.isNotEmpty())

        val pdf = api.download("/invoices/${list.rows.first()["id"].int}/pdf")
        assertEquals("application/pdf", pdf.mimeType)
        assertEquals("%PDF-", String(pdf.bytes, 0, 5))

        val file: JsonObject = api.upload("/files/upload", listOf(UploadFile("Quittung Café.txt", "text/plain", "Kaffee 4.50".toByteArray())), fileField = "file")
        val download = api.download("/files/${file["id"].int}/download")
        assertEquals("Quittung Café.txt", download.filename)
        assertEquals("Kaffee 4.50", String(download.bytes))

        val events = api.agent(obj("text" to "Hallo")).toList()
        assertEquals("no_agent", (events.last() as ch.batzio.app.core.AgentEvent.Error).message)

        val folder = LocalEngine.defaultDirectory(context)
        assertTrue(File(folder, "control.sqlite").exists())
        assertTrue(File(folder, "tenant-001.sqlite").exists())

        try {
            Api(LocalEngine.ORIGIN, "nope", "muster-gmbh").get<Bootstrap>("/app/bootstrap")
            fail("expected 401")
        } catch (e: ApiException) {
            assertTrue(e.isUnauthorized)
        }
    }
}
