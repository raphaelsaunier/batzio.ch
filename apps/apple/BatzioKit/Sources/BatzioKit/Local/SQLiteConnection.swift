import Foundation
import SQLite3

/// One SQLite file, spoken to the way the on-device engine expects (D1 semantics):
/// rows as dictionaries, the number of changed rows and the last inserted id.
final class SQLiteConnection {
    struct Failure: Error, CustomStringConvertible {
        let description: String
    }

    private var db: OpaquePointer?
    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    init(path: String) throws {
        guard sqlite3_open_v2(path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX, nil) == SQLITE_OK else {
            let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "cannot open \(path)"
            sqlite3_close(db)
            throw Failure(description: message)
        }
        sqlite3_busy_timeout(db, 5000)
        // D1 enforces foreign keys; WAL keeps the file consistent if the app is killed mid-write.
        try execute("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;")
    }

    deinit { sqlite3_close_v2(db) }

    func execute(_ sql: String) throws {
        var error: UnsafeMutablePointer<CChar>?
        guard sqlite3_exec(db, sql, nil, nil, &error) == SQLITE_OK else {
            let message = error.map { String(cString: $0) } ?? "SQLite error"
            sqlite3_free(error)
            throw Failure(description: message)
        }
    }

    /// Runs one statement. `params` come from JSON: numbers, strings, null, or `{"$bytes": base64}`.
    func run(_ sql: String, _ params: [Any]) throws -> [String: Any] {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw failure() }
        defer { sqlite3_finalize(stmt) }
        for (i, value) in params.enumerated() {
            let index = Int32(i + 1)
            let rc: Int32
            switch value {
            case is NSNull:
                rc = sqlite3_bind_null(stmt, index)
            case let n as NSNumber:
                if CFGetTypeID(n) == CFBooleanGetTypeID() {
                    rc = sqlite3_bind_int64(stmt, index, n.boolValue ? 1 : 0)
                } else if CFNumberIsFloatType(n) {
                    // JSON writes whole numbers without a fraction, so a float here has one (or is huge).
                    rc = sqlite3_bind_double(stmt, index, n.doubleValue)
                } else {
                    rc = sqlite3_bind_int64(stmt, index, n.int64Value)
                }
            case let s as String:
                rc = sqlite3_bind_text(stmt, index, s, -1, Self.transient)
            case let d as [String: Any]:
                let bytes = (d["$bytes"] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
                rc = bytes.withUnsafeBytes { sqlite3_bind_blob(stmt, index, $0.baseAddress, Int32(bytes.count), Self.transient) }
            default:
                rc = sqlite3_bind_text(stmt, index, "\(value)", -1, Self.transient)
            }
            guard rc == SQLITE_OK else { throw failure() }
        }

        var rows: [[String: Any]] = []
        let columns = sqlite3_column_count(stmt)
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw failure() }
            var row: [String: Any] = [:]
            for c in 0..<columns {
                let name = String(cString: sqlite3_column_name(stmt, c))
                switch sqlite3_column_type(stmt, c) {
                case SQLITE_INTEGER: row[name] = sqlite3_column_int64(stmt, c)
                case SQLITE_FLOAT: row[name] = sqlite3_column_double(stmt, c)
                case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(stmt, c))
                case SQLITE_BLOB:
                    let count = Int(sqlite3_column_bytes(stmt, c))
                    let data = count > 0 ? Data(bytes: sqlite3_column_blob(stmt, c), count: count) : Data()
                    row[name] = ["$bytes": data.base64EncodedString()]
                default: row[name] = NSNull()
                }
            }
            rows.append(row)
        }
        let readonly = sqlite3_stmt_readonly(stmt) != 0
        return [
            "rows": rows,
            "changes": readonly ? 0 : Int(sqlite3_changes(db)),
            "lastRowId": readonly ? 0 : Int(sqlite3_last_insert_rowid(db)),
        ]
    }

    /// Runs statements in one transaction (D1 batches are atomic).
    func batch(_ statements: [(sql: String, params: [Any])]) throws -> [[String: Any]] {
        try execute("BEGIN IMMEDIATE")
        do {
            let results = try statements.map { try run($0.sql, $0.params) }
            try execute("COMMIT")
            return results
        } catch {
            try? execute("ROLLBACK")
            throw error
        }
    }

    private func failure() -> Failure {
        Failure(description: String(cString: sqlite3_errmsg(db)))
    }
}
