import BatzioKit
import Foundation

/// How a field's value reads on screen (same rules as the web cells).
enum FieldText {
    static func text(_ field: FieldDef, _ value: JSONValue?, labels: Labels = [:], currency: String = "CHF") -> String {
        guard let value, !value.isNull else { return "" }
        switch field.type {
        case .money: return Fmt.amount(value.double)
        case .decimal: return Fmt.number(value.double)
        case .percent: return Fmt.percent(value.double)
        case .int: return field.format == "duration" ? Fmt.duration(value.double) : (value.int.map(String.init) ?? value.displayText)
        case .date: return Fmt.date(value.string)
        case .datetime: return Fmt.dateTime(value.string)
        case .boolean: return value.bool == true ? L("Yes") : L("No")
        case .enum: return field.option(for: value)?.label ?? value.displayText
        case .ref:
            guard let id = value.string else { return "" }
            return labels[field.name]?[id] ?? "#\(id)"
        case .tags:
            let ids = value.array?.compactMap(\.string) ?? (value.string.map { (try? JSONDecoder().decode([Int].self, from: Data($0.utf8)))?.map(String.init) ?? [] } ?? [])
            return ids.map { labels[field.name]?[$0] ?? "#\($0)" }.joined(separator: ", ")
        case .json: return ""
        default: return value.displayText
        }
    }

    static func isEmpty(_ value: JSONValue?) -> Bool {
        guard let value else { return true }
        if value.isNull { return true }
        if case .string(let s) = value { return s.isEmpty }
        if case .array(let a) = value { return a.isEmpty }
        return false
    }
}

extension ResourceSchema {
    /// Fields grouped into form sections, in definition order.
    func sections(_ fields: [FieldDef]) -> [(title: String?, fields: [FieldDef])] {
        var out: [(String?, [FieldDef])] = []
        for f in fields {
            if let i = out.firstIndex(where: { $0.0 == f.section }) { out[i].1.append(f) } else { out.append((f.section, [f])) }
        }
        return out.map { (title: $0.0, fields: $0.1) }
    }
}
