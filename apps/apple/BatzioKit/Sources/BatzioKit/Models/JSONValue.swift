import Foundation

/// Any JSON value. Records travel as `[String: JSONValue]` because their shape
/// comes from the server's resource definitions, not from compiled types.
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n):
            if n.rounded() == n, abs(n) < 9_007_199_254_740_992 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public var isNull: Bool { if case .null = self { true } else { false } }

    public var string: String? {
        switch self {
        case .string(let s): s
        case .number(let n): n.rounded() == n ? String(Int64(n)) : String(n)
        case .bool(let b): b ? "true" : "false"
        default: nil
        }
    }

    public var double: Double? {
        switch self {
        case .number(let n): n
        case .string(let s): Double(s)
        case .bool(let b): b ? 1 : 0
        default: nil
        }
    }

    public var int: Int? { double.map { Int($0) } }

    public var bool: Bool? {
        switch self {
        case .bool(let b): b
        case .number(let n): n != 0
        case .string(let s): ["1", "true", "yes"].contains(s.lowercased())
        default: nil
        }
    }

    public var array: [JSONValue]? { if case .array(let a) = self { a } else { nil } }
    public var object: [String: JSONValue]? { if case .object(let o) = self { o } else { nil } }

    public subscript(key: String) -> JSONValue? { object?[key] }

    /// Plain text for display when nothing better is known.
    public var displayText: String {
        switch self {
        case .null: ""
        case .array(let a): a.map(\.displayText).joined(separator: ", ")
        case .object: ""
        default: string ?? ""
        }
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(nilLiteral: ()) { self = .null }
}

public typealias Record = [String: JSONValue]

public extension Record {
    var id: Int? { self["id"]?.int }
}
