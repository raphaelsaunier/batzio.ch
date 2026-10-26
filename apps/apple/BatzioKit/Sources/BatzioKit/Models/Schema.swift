import Foundation

// The app draws every module from these definitions (GET /app/bootstrap), the
// same resource registry that drives the web screens, REST API and MCP tools.

public struct UserInfo: Codable, Hashable, Sendable {
    public let id: String
    public let name: String
    public let email: String
    public var locale: String?
}

public struct TenantInfo: Codable, Hashable, Sendable {
    public let id: String
    public let slug: String
    public let name: String
    public let locale: String
}

public struct Company: Codable, Hashable, Sendable, Identifiable {
    public let slug: String
    public let name: String
    public let role: String
    public let locale: String
    public var id: String { slug }
}

/// A destination inside the app, as the server describes it.
public enum AppTarget: Hashable, Sendable, Decodable {
    case today
    case reports(String?)
    case resource(String, id: Int?, create: Bool)
    case bankImport
    case payroll
    case settings(String?)
    case file(Int)
    case url(String)

    private enum Keys: String, CodingKey { case kind, report, resource, id, create, section, href }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decode(String.self, forKey: .kind) {
        case "today": self = .today
        case "reports": self = .reports(try c.decodeIfPresent(String.self, forKey: .report))
        case "resource":
            self = .resource(try c.decode(String.self, forKey: .resource), id: try c.decodeIfPresent(Int.self, forKey: .id), create: try c.decodeIfPresent(Bool.self, forKey: .create) ?? false)
        case "bank_import": self = .bankImport
        case "payroll": self = .payroll
        case "settings": self = .settings(try c.decodeIfPresent(String.self, forKey: .section))
        case "file": self = .file(try c.decode(Int.self, forKey: .id))
        default: self = .url(try c.decodeIfPresent(String.self, forKey: .href) ?? "")
        }
    }
}

public struct NavTab: Decodable, Hashable, Sendable {
    public let title: String
    public let target: AppTarget
}

public struct NavItem: Decodable, Hashable, Sendable, Identifiable {
    public let title: String
    public let icon: String
    public let target: AppTarget
    public let tabs: [NavTab]
    public var id: String { "\(title)|\(target)" }
}

public struct NavSection: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let icon: String
    public let items: [NavItem]
}

public enum FieldType: String, Codable, Sendable {
    case string, text, email, url, phone, int, decimal, money, percent, date, datetime, time, boolean
    case `enum`, ref, tags, json, iban, color
    case unknown

    public init(from decoder: Decoder) throws {
        self = FieldType(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown
    }
}

public enum Tone: String, Codable, Sendable {
    case neutral, info, success, warning, danger, muted, primary
    public init(from decoder: Decoder) throws {
        self = Tone(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .neutral
    }
}

public struct FieldOption: Codable, Hashable, Sendable, Identifiable {
    public let value: String
    public let label: String
    public let tone: Tone?
    public var id: String { value }
}

public struct FieldDef: Decodable, Hashable, Sendable, Identifiable {
    public let name: String
    public let label: String
    public let type: FieldType
    public let description: String?
    public let required: Bool?
    public let readOnly: Bool?
    public let createOnly: Bool?
    public let `default`: JSONValue?
    public let options: [FieldOption]?
    public let ref: String?
    public let refFilter: [String: JSONValue]?
    public let list: Bool?
    public let search: Bool?
    public let filter: Bool?
    public let sortable: Bool?
    public let placeholder: String?
    public let section: String?
    public let span: Int?
    public let min: Double?
    public let max: Double?
    public let maxLength: Int?
    public let hidden: Bool?
    public let format: String?
    public let term: String?
    public var id: String { name }

    public var isEditable: Bool { !(readOnly ?? false) && !(hidden ?? false) && type != .json }
    public func option(for value: JSONValue?) -> FieldOption? {
        guard let v = value?.string else { return nil }
        return options?.first { $0.value == v }
    }
}

public struct ChildDef: Decodable, Hashable, Sendable, Identifiable {
    public let name: String
    public let label: String
    public let fields: [FieldDef]
    public var id: String { name }
}

public struct ActionDef: Decodable, Hashable, Sendable, Identifiable {
    public let name: String
    public let label: String
    public let description: String
    public let icon: String?
    public let variant: String?
    public let confirm: String?
    public let input: [FieldDef]?
    public var id: String { name }
    public var isDestructive: Bool { variant == "destructive" }
}

public struct RelatedDef: Decodable, Hashable, Sendable {
    public let resource: String
    public let foreignKey: String
    public let label: String
}

public struct EmptyCopy: Decodable, Hashable, Sendable {
    public let title: String
    public let text: String
    public let mood: String?
}

public struct SortSpec: Decodable, Hashable, Sendable {
    public let field: String
    public let dir: String
}

public struct NavPlacement: Decodable, Hashable, Sendable {
    public let group: String
    public let order: Int
}

public struct ResourceSchema: Decodable, Hashable, Sendable, Identifiable {
    public let name: String
    public let singular: String
    public let label: String
    public let labelPlural: String
    public let description: String
    public let icon: String
    public let area: String
    public let fields: [FieldDef]
    public let children: [ChildDef]
    public let actions: [ActionDef]
    public let related: [RelatedDef]
    public let statusField: String?
    public let view: String
    public let softDelete: Bool
    public let readOnly: Bool
    public let noCreate: Bool
    public let noDelete: Bool
    public let empty: EmptyCopy?
    public let defaultSort: SortSpec
    public let nav: NavPlacement?
    public let canWrite: Bool
    public let canCreate: Bool
    public let pdf: Bool
    public var id: String { name }

    public var isDocument: Bool { view == "document" }
    public var listFields: [FieldDef] { fields.filter { ($0.list ?? false) && !($0.hidden ?? false) } }
    public var statusDef: FieldDef? { statusField.flatMap { s in fields.first { $0.name == s } } }
    public func field(_ name: String) -> FieldDef? { fields.first { $0.name == name } }
    public func action(_ name: String) -> ActionDef? { actions.first { $0.name == name } }
}

public struct ReportInfo: Decodable, Hashable, Sendable, Identifiable {
    public let id: String
    public let title: String
    public let text: String
    public let icon: String
    public let area: String
    public let params: String
    public let pdf: String?
}

public struct GlossaryEntry: Decodable, Hashable, Sendable {
    public let term: String
    public let text: String
}

public struct Bootstrap: Decodable, Sendable {
    public let locale: String
    public let mode: String
    public let user: UserInfo?
    public let tenant: TenantInfo
    public let role: String
    public let permissions: [String: String]
    public let navigation: [NavSection]
    public let resources: [ResourceSchema]
    public let reports: [ReportInfo]
    public let glossary: [String: GlossaryEntry?]
    public let agent: Bool
    public let inbox: String?
    public let examples: [String]

    public func resource(_ name: String) -> ResourceSchema? { resources.first { $0.name == name } }
    public func can(_ area: String, write: Bool = false) -> Bool {
        let level = permissions[area] ?? "none"
        return write ? level == "write" : level != "none"
    }
    public func explain(_ term: String?) -> GlossaryEntry? {
        guard let term else { return nil }
        return glossary[term] ?? nil
    }
}
