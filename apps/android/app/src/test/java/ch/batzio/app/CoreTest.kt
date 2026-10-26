package ch.batzio.app

import ch.batzio.app.core.AgentEvent
import ch.batzio.app.core.Bootstrap
import ch.batzio.app.core.BzJson
import ch.batzio.app.core.Fmt
import ch.batzio.app.core.I18n
import ch.batzio.app.core.L
import ch.batzio.app.core.arr
import ch.batzio.app.core.bool
import ch.batzio.app.core.int
import ch.batzio.app.core.isNull
import ch.batzio.app.core.num
import ch.batzio.app.core.str
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class CoreTest {
    @Test fun readsRecordsLoosely() {
        val r = BzJson.decodeFromString<JsonObject>("""{"id":12,"nr":"INV-1","total":1891.75,"paid":false,"positions":[{"text":"Design"}],"contact_id":null}""")
        assertEquals(12, r["id"].int)
        assertEquals("12", r["id"].str)
        assertEquals(1891.75, r["total"].num!!, 0.0)
        assertEquals(false, r["paid"].bool)
        assertEquals(1, r["positions"].arr!!.size)
        assertTrue(r["contact_id"].isNull)
    }

    @Test fun formatsSwissStyle() {
        assertEquals("1’234.50", Fmt.amount(1234.5))
        assertEquals("CHF -42.00", Fmt.money(-42.0))
        assertEquals("2:30 h", Fmt.duration(150.0))
        assertEquals("25.10.2026", Fmt.date("2026-10-25"))
    }

    @Test fun parsesAgentStream() {
        assertEquals(AgentEvent.Thread("t1"), AgentEvent.parse("""{"type":"thread","threadId":"t1"}"""))
        assertEquals(AgentEvent.Text("Grüezi"), AgentEvent.parse("""{"type":"text","delta":"Grüezi"}"""))
        val tool = AgentEvent.parse("""{"type":"tool","outcome":{"id":"tu1","tool":"create_invoice","title":"Invoice","ok":true,"record":{"resource":"invoices","id":3}}}""")
        assertEquals(3, (tool as AgentEvent.Tool).outcome.record?.id)
        assertEquals(null, AgentEvent.parse("""{"type":"mystery"}"""))
    }

    @Test fun usesTheSharedCatalog() {
        // The generated catalog that ships in assets (packages/i18n → pnpm gen).
        I18n.load(File("src/main/assets/strings.json").readText())
        I18n.locale = "fr"
        assertEquals("Aujourd’hui", L("Today"))
        assertEquals("3 entrées", L("{n} records", "n" to 3))
        I18n.locale = "en"
        assertEquals("Today", L("Today"))
    }

    @Test fun decodesBootstrapShape() {
        val json = """{"locale":"de","mode":"simple","tenant":{"id":"t","slug":"acme","name":"Acme","locale":"de-CH"},"role":"owner","permissions":{"sales":"write"},
            "navigation":[{"id":"overview","label":"","icon":"Sun","items":[{"title":"Heute","icon":"Sun","target":{"kind":"today"},"tabs":[]}]}],
            "resources":[{"name":"invoices","singular":"invoice","label":"Rechnung","labelPlural":"Rechnungen","description":"","icon":"Receipt","area":"sales","fields":[{"name":"total","label":"Total","type":"money","list":true}],"defaultSort":{"field":"date","dir":"desc"},"canCreate":true,"pdf":true,"future":"ignored"}],
            "reports":[],"glossary":{"vat":{"term":"MWST","text":"…"}},"agent":false,"inbox":null,"examples":["Hallo"]}"""
        val b = BzJson.decodeFromString<Bootstrap>(json)
        assertEquals("today", b.navigation[0].items[0].target.kind)
        assertEquals("money", b.resource("invoices")!!.listFields[0].type)
        assertEquals("MWST", b.explain("vat")!!.term)
    }
}
