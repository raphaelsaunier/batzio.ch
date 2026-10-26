import Foundation

// Response bodies of the app endpoints (`/api/v1/app/*`, `/auth/*`, `/api/agent`).
// Amounts are in major units (CHF), dates are ISO strings.

public struct AuthResult: Decodable, Sendable {
    public let token: String
    public let expires: String
    public let user: UserInfo
    public let companies: [Company]
}

public struct AccountInfo: Decodable, Sendable {
    public let user: UserInfo
    public let companies: [Company]
}

public struct RecordRef: Codable, Hashable, Sendable {
    public let resource: String
    public let id: Int
    public let label: String?
}

// MARK: Today

public struct WeatherWeek: Decodable, Hashable, Sendable {
    public let week: String
    public let balance: Double
}

public struct MoneyWeather: Decodable, Sendable {
    public struct Low: Decodable, Sendable { public let balance: Double; public let week: String }
    public let mood: String
    public let cash: Double
    public let incoming: Double
    public let outgoing: Double
    public let low: Low
    public let weeks: [WeatherWeek]
}

public struct NudgeAction: Decodable, Hashable, Sendable {
    public let kind: String
    public let label: String
    public let target: AppTarget?
    public let resource: String?
    public let id: Int?
    public let action: String?
    public let prompt: String?
    public let fileId: Int?
    public let inboxId: Int?
    public let primary: Bool?
    public let agent: Bool?
}

public struct Nudge: Decodable, Hashable, Sendable, Identifiable {
    public let key: String
    public let icon: String
    public let tone: String
    public let title: String
    public let text: String?
    public let amount: Double?
    public let actions: [NudgeAction]
    public var id: String { key }
}

public struct InboxItem: Decodable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let source: String
    public let kind: String
    public let status: String
    public let title: String
    public let summary: String?
    public let file_id: Int?
    public let sender: String?
    public let subject: String?
    public let result: String?
    public let error: String?
    public let thread_id: String?
    public let created_at: String
}

public struct ThreadSummary: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let started: String
    public let last: String
    public let count: Int
    public let title: String
}

public struct TodayScreen: Decodable, Sendable {
    public let greeting: String
    public let name: String
    public let weather: MoneyWeather?
    public let nudges: [Nudge]
    public let inbox: [InboxItem]
    public let threads: [ThreadSummary]
}

// MARK: Quick sentences

public struct QuickAction: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let primary: Bool?
}

public struct QuickPlan: Decodable, Hashable, Sendable {
    public let headline: String
    public let details: [String]
    public let warnings: [String]
    public let actions: [QuickAction]
    public let total: Double?
}

public struct QuickOutcome: Decodable, Sendable {
    public let message: String
    public let record: RecordRef?
    public let celebrate: Bool?
}

// MARK: Batzi

public struct FileRef: Codable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let name: String
    public let mime: String?
}

public struct ToolOutcome: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let tool: String
    public let title: String
    public let ok: Bool
    public let summary: String?
    public let record: RecordRef?
    public let pending: Bool?
    public let input: [String: JSONValue]?
}

public struct ChatTurn: Decodable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let role: String
    public var text: String
    public let at: String
    public let files: [FileRef]?
    public let via: String?
    public var updates: [String]?
    public var tools: [ToolOutcome]?
    public var refused: Bool?
}

public struct DropOutcome: Decodable, Hashable, Sendable {
    public let file: FileRef
    public let handled: Bool
    public let kind: String
    public let text: String?
    public let records: [RecordRef]
    public let inboxId: Int
}

public struct StoredFile: Decodable, Sendable { public let file: FileRef }

// MARK: Records

public typealias Labels = [String: [String: String]]

public struct RecordList: Decodable, Sendable {
    public let rows: [Record]
    public let labels: Labels
    public let titles: [String: String]
    public let total: Int
    public let limit: Int
    public let offset: Int
    public let totals: [String: Double]
}

public struct TaxOption: Decodable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let code: String
    public let rate: Double
    public let type: String
}

public struct RelatedRow: Decodable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let title: String
    public let status: JSONValue?
    public let values: Record
}

public struct RelatedList: Decodable, Hashable, Sendable, Identifiable {
    public let resource: String
    public let label: String
    public let foreignKey: String
    public let total: Int
    public let rows: [RelatedRow]
    public var id: String { "\(resource).\(foreignKey)" }
}

public struct Attachment: Decodable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let name: String
    public let mime_type: String?
    public let size: Int
}

public struct HistoryEntry: Decodable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let at: String
    public let actor_name: String?
    public let source: String
    public let action: String
    public let summary: String?
    /// The change in words (older servers send only the fields above).
    public let title: String?
    public let when: String?
    public let actor: HistoryActor?
    public let provenance: [HistoryProvenance]?
    public let device: String?
    public let changes: [HistoryChange]?
    public let undo: HistoryUndo?
}

public struct HistoryActor: Decodable, Hashable, Sendable {
    public let name: String?
    /// Batzi, an MCP client, an API script, an email or an import rather than a person.
    public let automated: Bool
    public let sourceLabel: String
}

public struct HistoryProvenance: Decodable, Hashable, Sendable {
    public let label: String
    public let detail: String?
}

public struct HistoryChange: Decodable, Hashable, Sendable {
    public let field: String
    public let label: String
    /// "changed", "added" or "removed".
    public let kind: String
    public let from: String?
    public let to: String?
}

public struct HistoryUndo: Decodable, Hashable, Sendable {
    public let possible: Bool
    public let undoneBy: Int?
}

public struct RecordScreen: Decodable, Sendable {
    public let record: Record
    public let title: String
    public let labels: Labels
    public let taxes: [TaxOption]
    public let rounding: [String: Double]
    public let actions: [String]
    public let canEdit: Bool
    public let canDelete: Bool
    public let locked: String?
    public let archived: Bool
    public let pdf: String?
    public let related: [RelatedList]
    public let files: [Attachment]
    public let history: [HistoryEntry]
}

public struct NewRecord: Decodable, Sendable {
    public let values: Record
    public let taxes: [TaxOption]
    public let rounding: [String: Double]
}

public struct ActionResponse: Decodable, Sendable {
    public let message: String?
    public let redirect: RecordRef?
    public let record: Record?

    private enum Keys: String, CodingKey { case message, redirect, record }
    private struct Redirect: Decodable { let resource: String; let id: Int }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        message = try c.decodeIfPresent(String.self, forKey: .message)
        record = try c.decodeIfPresent(Record.self, forKey: .record)
        redirect = try c.decodeIfPresent(Redirect.self, forKey: .redirect).map { RecordRef(resource: $0.resource, id: $0.id, label: nil) }
    }
}

public struct RefOption: Decodable, Hashable, Sendable, Identifiable {
    public let id: Int
    public let label: String
}

public struct ItemDefaults: Decodable, Sendable {
    public let code: String?
    public let text: String
    public let unit_name: String?
    public let unit_price: Double
    public let tax_id: Int?
    public let tax_label: String?
}

public struct DocumentTotals: Decodable, Hashable, Sendable {
    public struct Line: Decodable, Hashable, Sendable { public let total: Double; public let subtotal: Double? }
    public struct Vat: Decodable, Hashable, Sendable { public let rate: Double; public let base: Double; public let vat: Double }
    public let lines: [Line]
    public let total_net: Double
    public let total_vat: Double
    public let rounding: Double
    public let total: Double
    public let vat: [Vat]
}

public struct SearchHit: Decodable, Hashable, Sendable, Identifiable {
    public let resource: String
    public let resourceLabel: String
    public let id: Int
    public let label: String
    public var key: String { "\(resource)/\(id)" }
}

// MARK: Reports

public struct ReportColumn: Decodable, Hashable, Sendable {
    public let label: String
    public let type: String
    public let term: String?
    public var isNumeric: Bool { type == "money" || type == "number" }
}

public struct ReportRow: Decodable, Hashable, Sendable {
    public let cells: [JSONValue]
    public let style: String?
    public let indent: Int?
    public let link: RecordRef?
}

public struct ReportTable: Decodable, Hashable, Sendable {
    public let title: String?
    public let columns: [ReportColumn]
    public let rows: [ReportRow]
}

public struct ReportSummary: Decodable, Hashable, Sendable {
    public let label: String
    public let value: Double
    public let tone: String?
}

public struct ReportScreen: Decodable, Sendable {
    public let id: String
    public let title: String
    public let subtitle: String
    public let params: String
    public let query: [String: String]
    public let summary: [ReportSummary]
    public let tables: [ReportTable]
    public let balanced: Bool?
    public let pdf: String?
}

// MARK: Settings & administration

public struct SettingsForm: Decodable, Sendable {
    public let fields: [FieldDef]
    public let values: Record
}

public struct SettingsForms: Decodable, Sendable {
    public let company: SettingsForm
    public let accounting: SettingsForm
    public let texts: SettingsForm
}

public struct NumberFormat: Decodable, Hashable, Sendable, Identifiable {
    public let key: String
    public let label: String
    public let format: String
    public let next_value: Int
    public let preview: String
    public var id: String { key }
}

public struct SettingsScreen: Decodable, Sendable {
    public let forms: SettingsForms
    public let numbering: [NumberFormat]
    public let inbox: String?
    public let agent: Bool
    public let canWrite: Bool
}

public struct Member: Decodable, Hashable, Sendable, Identifiable {
    public let user_id: String
    public let email: String
    public let name: String
    public let role: String
    public let last_login_at: String?
    public var id: String { user_id }
}

public struct Invitation: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let email: String
    public let role: String
    public let expires_at: String
}

public struct TeamScreen: Decodable, Sendable {
    public let members: [Member]
    public let invitations: [Invitation]
    public let me: String?
    public let canWrite: Bool
}

public struct ApiKeyInfo: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let name: String
    public let prefix: String
    public let scope: String
    public let role: String
    public let user_name: String
    public let last_used_at: String?
    public let revoked_at: String?
    public let created_at: String
}

public struct CreatedApiKey: Decodable, Sendable {
    public let key: String
    public let id: String
    public let message: String
}

public struct InviteResult: Decodable, Sendable {
    public let added: Bool
    public let link: String?
    public let message: String
}

public struct MessageResult: Decodable, Sendable {
    public let message: String
}

public struct BankImportResult: Decodable, Sendable {
    public let imported: Int
    public let duplicates: Int
    public let suggested: Int
    public let booked: Int
}
