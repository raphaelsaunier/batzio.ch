import Foundation
import Testing
@testable import BatzioKit

@Suite struct JSONValueTests {
    @Test func decodesRecordsLoosely() throws {
        let json = #"{"id": 12, "nr": "INV-2026-0001", "total": 1891.75, "is_paid": false, "positions": [{"text": "Design"}], "contact_id": null}"#
        let record = try JSONDecoder().decode(Record.self, from: Data(json.utf8))
        #expect(record.id == 12)
        #expect(record["nr"]?.string == "INV-2026-0001")
        #expect(record["total"]?.double == 1891.75)
        #expect(record["is_paid"]?.bool == false)
        #expect(record["positions"]?.array?.first?["text"]?.string == "Design")
        #expect(record["contact_id"]?.isNull == true)
    }

    @Test func encodesWholeNumbersWithoutFraction() throws {
        let data = try JSONEncoder().encode(["n": JSONValue.number(3), "x": .number(2.5)])
        let text = String(decoding: data, as: UTF8.self)
        #expect(text.contains("\"n\":3"))
        #expect(text.contains("\"x\":2.5"))
    }
}

@Suite struct SchemaTests {
    @Test func decodesTargets() throws {
        let json = #"[{"kind":"today"},{"kind":"resource","resource":"invoices","id":4},{"kind":"settings","section":"team"},{"kind":"bank_import"},{"kind":"file","id":9}]"#
        let targets = try JSONDecoder().decode([AppTarget].self, from: Data(json.utf8))
        #expect(targets == [.today, .resource("invoices", id: 4, create: false), .settings("team"), .bankImport, .file(9)])
    }

    @Test func toleratesUnknownFieldTypes() throws {
        let json = #"{"name":"x","label":"X","type":"hologram"}"#
        let field = try JSONDecoder().decode(FieldDef.self, from: Data(json.utf8))
        #expect(field.type == .unknown)
    }
}

@Suite struct AgentStreamTests {
    @Test func parsesEveryEventType() {
        #expect(AgentEvent.parse(#"{"type":"thread","threadId":"t1"}"#) == .thread("t1"))
        #expect(AgentEvent.parse(#"{"type":"text","delta":"Grüezi"}"#) == .text("Grüezi"))
        #expect(AgentEvent.parse(#"{"type":"update","text":"Reading the receipt","start":true}"#) == .update("Reading the receipt", start: true))
        #expect(AgentEvent.parse(#"{"type":"done","refused":false}"#) == .done(refused: false))
        #expect(AgentEvent.parse(#"{"type":"error","message":"no_agent"}"#) == .error("no_agent"))
        if case .tool(let outcome) = AgentEvent.parse(#"{"type":"tool","outcome":{"id":"tu1","tool":"create_invoice","title":"Invoice","ok":true,"record":{"resource":"invoices","id":3,"label":"INV-1"}}}"#) {
            #expect(outcome.record?.id == 3)
        } else {
            Issue.record("tool event not parsed")
        }
        #expect(AgentEvent.parse("") == nil)
        #expect(AgentEvent.parse(#"{"type":"mystery"}"#) == nil)
    }
}

@Suite struct FormattingTests {
    @Test func swissMoney() {
        #expect(Fmt.amount(1234.5) == "1’234.50")
        #expect(Fmt.money(-42) == "CHF -42.00")
        #expect(Fmt.duration(150) == "2:30 h")
        #expect(Fmt.date("2026-10-25") == "25.10.2026")
    }

    @Test func translatesAndInterpolates() {
        #expect(I18n.preferred(["fr-CH", "en"]) == "fr")
        #expect(I18n.preferred(["ja-JP"]) == "en")
        #expect(I18n.interpolate("{n} records", ["n": 3]) == "3 records")
        #expect(I18n.translate("A sentence nobody wrote", locale: "de") == "A sentence nobody wrote")
        // The bundled catalog (generated from packages/i18n) loads.
        #expect(I18n.translate("Today", locale: "de") == "Heute")
        #expect(I18n.translate("Today", locale: "fr") == "Aujourd’hui")
    }
}

@Suite struct ClientTests {
    @Test func buildsRequests() {
        let client = APIClient(baseURL: URL(string: "https://example.test/base")!, token: "abc", tenant: "acme", locale: "it")
        let r = client.request("GET", "/api/v1/app/today", query: ["mode": "simple"])
        #expect(r.url?.absoluteString == "https://example.test/base/api/v1/app/today?mode=simple&locale=it")
        #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer abc")
        #expect(r.value(forHTTPHeaderField: "X-Tenant") == "acme")
        #expect(r.value(forHTTPHeaderField: "Accept-Language") == "it")
    }
}
