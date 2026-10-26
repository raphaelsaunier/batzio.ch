import Foundation

/// Swiss number, money and date formatting, matching the web (`1'234.50`).
public enum Fmt {
    private static func numberFormatter(_ digits: Int) -> NumberFormatter {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.minimumFractionDigits = digits
        f.maximumFractionDigits = digits
        f.groupingSeparator = "’"
        f.decimalSeparator = "."
        f.usesGroupingSeparator = true
        return f
    }

    public static func amount(_ value: Double?, digits: Int = 2) -> String {
        guard let value else { return "" }
        return numberFormatter(digits).string(from: NSNumber(value: value)) ?? String(value)
    }

    public static func money(_ value: Double?, currency: String = "CHF") -> String {
        guard let value else { return "" }
        return "\(currency) \(amount(value))"
    }

    public static func number(_ value: Double?) -> String {
        guard let value else { return "" }
        return value.rounded() == value ? amount(value, digits: 0) : amount(value, digits: value * 100 == (value * 100).rounded() ? 2 : 4)
    }

    public static func percent(_ value: Double?) -> String {
        guard let value else { return "" }
        return "\(number(value)) %"
    }

    private static let isoDate: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Europe/Zurich")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    public static func parseDate(_ iso: String?) -> Date? {
        guard let iso, iso.count >= 10 else { return nil }
        return isoDate.date(from: String(iso.prefix(10)))
    }

    public static func isoString(_ date: Date) -> String { isoDate.string(from: date) }

    /// `25.10.2026`
    public static func date(_ iso: String?) -> String {
        guard let d = parseDate(iso) else { return iso ?? "" }
        let f = DateFormatter()
        f.locale = I18n.formattingLocale
        f.timeZone = TimeZone(identifier: "Europe/Zurich")
        f.dateFormat = "dd.MM.yyyy"
        return f.string(from: d)
    }

    public static func dateTime(_ iso: String?) -> String {
        guard let iso else { return "" }
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let d = parser.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        guard let d else { return date(iso) }
        let f = DateFormatter()
        f.locale = I18n.formattingLocale
        f.timeZone = TimeZone(identifier: "Europe/Zurich")
        f.dateFormat = "dd.MM.yyyy HH:mm"
        return f.string(from: d)
    }

    /// Minutes as `2:30 h`.
    public static func duration(_ minutes: Double?) -> String {
        guard let minutes else { return "" }
        let m = Int(minutes.rounded())
        return "\(m / 60):\(String(format: "%02d", m % 60)) h"
    }

    public static func bytes(_ size: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(size), countStyle: .file)
    }
}
