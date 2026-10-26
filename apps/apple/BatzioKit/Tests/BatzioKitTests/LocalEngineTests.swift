import Foundation
import Testing
@testable import BatzioKit

/// The on-device mode end to end: the real engine bundle in JavaScriptCore,
/// SQLite files in a temporary folder, and the app's own API client on top.
@Suite(.serialized) struct LocalEngineTests {
    static let script: String = {
        // Tests/BatzioKitTests → BatzioKit → apple → apps → repository root.
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return (try? String(contentsOf: root.appendingPathComponent("packages/local/bundle/batzio-local.js"), encoding: .utf8)) ?? ""
    }()

    static func makeDirectory() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("batzio-local-\(UUID().uuidString)", isDirectory: true)
    }

    @Test func runsTheWholeAppOnTheDevice() async throws {
        #expect(!Self.script.isEmpty, "Build packages/local first: pnpm --filter @batzio/local build")
        let directory = Self.makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = try LocalEngine(directory: directory, script: Self.script, tenantSlots: 3)
        var api = APIClient(baseURL: LocalEngine.origin, locale: "de", transport: engine)

        let body: [String: JSONValue] = ["name": "Anna Muster", "email": "anna@device.local", "password": "on-this-device-only", "company": "Muster GmbH", "language": "de", "demo": true]
        let auth: AuthResult = try await api.send("POST", "/auth/signup", body: body)
        #expect(auth.companies.map(\.slug) == ["muster-gmbh"])
        api.token = auth.token
        api.tenant = "muster-gmbh"

        let boot: Bootstrap = try await api.get("/app/bootstrap", query: ["mode": "simple"])
        #expect(boot.navigation.first?.items.first?.title == "Heute")
        let list: RecordList = try await api.get("/app/records/invoices", query: ["limit": "5"])
        #expect(!list.rows.isEmpty)

        // A PDF with a QR-bill, rendered by pdf-lib inside JavaScriptCore.
        let first = try #require(list.rows.first?.id)
        let pdf = try await api.download("/invoices/\(first)/pdf")
        #expect(pdf.mimeType == "application/pdf")
        #expect(pdf.data.prefix(5) == Data("%PDF-".utf8))

        // Attachments land in the folder and keep their name.
        let uploaded: Record = try await api.upload("/files/upload", files: [UploadFile(name: "Quittung Café.txt", mimeType: "text/plain", data: Data("Kaffee 4.50".utf8))], fileField: "file")
        let download = try await api.download("/files/\(try #require(uploaded.id))/download")
        #expect(download.filename == "Quittung Café.txt")
        #expect(String(decoding: download.data, as: UTF8.self) == "Kaffee 4.50")

        // Batzi is not available offline, and says so through the usual stream.
        var events: [AgentEvent] = []
        for try await event in api.agent(AgentRequest(text: "Hallo")) { events.append(event) }
        #expect(events.last == .error("no_agent"))

        #expect(FileManager.default.fileExists(atPath: directory.appendingPathComponent("control.sqlite").path))
        #expect(FileManager.default.fileExists(atPath: directory.appendingPathComponent("tenant-001.sqlite").path))
    }

    @Test func keepsEverythingAcrossLaunches() async throws {
        let directory = Self.makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let body: [String: JSONValue] = ["name": "Luca", "email": "luca@device.local", "password": "on-this-device-only", "company": "Studio Luca", "language": "it", "demo": false]
        let token: String
        do {
            let engine = try LocalEngine(directory: directory, script: Self.script, tenantSlots: 2)
            let auth: AuthResult = try await APIClient(baseURL: LocalEngine.origin, transport: engine).send("POST", "/auth/signup", body: body)
            token = auth.token
        }
        let reopened = try LocalEngine(directory: directory, script: Self.script, tenantSlots: 2)
        let me: AccountInfo = try await APIClient(baseURL: LocalEngine.origin, token: token, transport: reopened).get("/auth/me")
        #expect(me.user.name == "Luca")
        #expect(me.companies.map(\.name) == ["Studio Luca"])
    }

    @Test func reportsEngineErrorsAsAPIErrors() async throws {
        let directory = Self.makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = try LocalEngine(directory: directory, script: Self.script, tenantSlots: 1)
        let api = APIClient(baseURL: LocalEngine.origin, token: "nope", tenant: "x", transport: engine)
        await #expect(throws: APIError.self) {
            let _: Bootstrap = try await api.get("/app/bootstrap")
        }
    }

    @Test func readsUTF8FileNames() {
        #expect(APIClient.filename(fromDisposition: #"attachment; filename="Quittung Cafe.txt"; filename*=UTF-8''Quittung%20Caf%C3%A9.txt"#) == "Quittung Café.txt")
        #expect(APIClient.filename(fromDisposition: #"inline; filename="INV-2026-0001.pdf""#) == "INV-2026-0001.pdf")
    }
}
