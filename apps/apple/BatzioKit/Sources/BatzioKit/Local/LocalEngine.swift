import CommonCrypto
import CryptoKit
import Foundation
import JavaScriptCore
import Security

/// Batzio without a server: the engine (`packages/local`, one script) runs in
/// JavaScriptCore on SQLite files in `directory` — `control.sqlite` for accounts,
/// `tenant-NNN.sqlite` per company and `files/` for attachments. The apps reach
/// it through the same REST API as online, at ``LocalEngine/origin``.
public final class LocalEngine: HTTPTransport, @unchecked Sendable {
    public static let origin = URL(string: "https://device.batzio.local")!

    public let directory: URL
    private let queue = DispatchQueue(label: "ch.batzio.local-engine")
    private var context: JSContext!
    private var databases: [String: SQLiteConnection] = [:]
    private var answers: [String: String] = [:]
    private var lastException: String?
    private var nextID = 0

    /// - Parameters:
    ///   - directory: where the SQLite files and attachments live (created if missing).
    ///   - script: the contents of `batzio-local.js`.
    public init(directory: URL, script: String, tenantSlots: Int = 20) throws {
        self.directory = directory
        try FileManager.default.createDirectory(at: directory.appendingPathComponent("files"), withIntermediateDirectories: true)
        try queue.sync {
            let context = JSContext()!
            context.name = "Batzio on this device"
            context.exceptionHandler = { [weak self] _, exception in
                self?.lastException = exception.map { "\($0)\n\($0.objectForKeyedSubscript("stack").toString() ?? "")" }
            }
            context.setObject(makeHost(in: context), forKeyedSubscript: "__batzio_host" as NSString)
            context.evaluateScript(script, withSourceURL: URL(string: "batzio-local.js"))
            if let error = lastException { throw SQLiteConnection.Failure(description: "The on-device engine failed to load: \(error)") }
            context.objectForKeyedSubscript("BatzioLocal").invokeMethod("configure", withArguments: [#"{"tenantSlots": \#(tenantSlots)}"#])
            self.context = context
        }
    }

    /// The default place for on-device data: Application Support/Batzio/On this device.
    public static func defaultDirectory() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            .appendingPathComponent("Batzio", isDirectory: true)
            .appendingPathComponent("On this device", isDirectory: true)
    }

    // MARK: HTTPTransport

    public func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result { try self.dispatch(request) })
            }
        }
    }

    private func dispatch(_ request: URLRequest) throws -> (Data, URLResponse) {
        nextID += 1
        let id = String(nextID)
        let url = request.url ?? Self.origin
        let wire: [String: Any] = [
            "method": request.httpMethod ?? "GET",
            "url": url.absoluteString,
            "headers": (request.allHTTPHeaderFields ?? [:]).map { [$0.key, $0.value] },
            "body": request.httpBody.map { $0.base64EncodedString() } ?? NSNull(),
        ]
        let json = String(decoding: try JSONSerialization.data(withJSONObject: wire), as: UTF8.self)
        lastException = nil
        context.objectForKeyedSubscript("BatzioLocal").invokeMethod("dispatch", withArguments: [id, json])
        // JavaScriptCore runs the engine's promise jobs before invokeMethod returns:
        // every host call is synchronous, so the answer is already here.
        guard let answer = answers.removeValue(forKey: id) else {
            throw SQLiteConnection.Failure(description: lastException ?? "The on-device engine did not answer.")
        }
        let response = try JSONSerialization.jsonObject(with: Data(answer.utf8)) as? [String: Any] ?? [:]
        let status = response["status"] as? Int ?? 500
        var headers: [String: String] = [:]
        for pair in response["headers"] as? [[String]] ?? [] where pair.count == 2 { headers[pair[0]] = pair[1] }
        let body = (response["body"] as? String).flatMap { Data(base64Encoded: $0) } ?? Data()
        let http = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        return (body, http)
    }

    // MARK: Host bridge (see packages/local/src/host-api.ts)

    private func makeHost(in context: JSContext) -> JSValue {
        let host = JSValue(newObjectIn: context)!
        func set(_ name: String, _ block: Any) {
            host.setObject(block, forKeyedSubscript: name as NSString)
        }
        let query: @convention(block) (String, String, String) -> String = { [weak self] db, sql, params in
            guard let self else { return #"{"error":"engine closed"}"# }
            return Self.encode {
                let values = try JSONSerialization.jsonObject(with: Data(params.utf8)) as? [Any] ?? []
                return try self.database(db).run(sql, values)
            }
        }
        let batch: @convention(block) (String, String) -> String = { [weak self] db, list in
            guard let self else { return #"{"error":"engine closed"}"# }
            return Self.encode {
                let items = try JSONSerialization.jsonObject(with: Data(list.utf8)) as? [[String: Any]] ?? []
                return try self.database(db).batch(items.map { ($0["sql"] as? String ?? "", $0["params"] as? [Any] ?? []) })
            }
        }
        let fileGet: @convention(block) (String) -> JSValue = { [weak self] key in
            guard let self, let url = self.fileURL(key), let data = try? Data(contentsOf: url) else { return JSValue(nullIn: JSContext.current()) }
            let type = (try? String(contentsOf: url.appendingPathExtension("content-type"), encoding: .utf8)) ?? "application/octet-stream"
            let json = try? JSONSerialization.data(withJSONObject: ["data": data.base64EncodedString(), "type": type])
            return JSValue(object: json.map { String(decoding: $0, as: UTF8.self) }, in: JSContext.current())
        }
        let filePut: @convention(block) (String, String, String) -> Void = { [weak self] key, data, type in
            guard let self, let url = self.fileURL(key), let bytes = Data(base64Encoded: data) else { return }
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? bytes.write(to: url, options: [.atomic, .completeFileProtection])
            try? type.write(to: url.appendingPathExtension("content-type"), atomically: true, encoding: .utf8)
        }
        let fileDelete: @convention(block) (String) -> Void = { [weak self] key in
            guard let self, let url = self.fileURL(key) else { return }
            try? FileManager.default.removeItem(at: url)
            try? FileManager.default.removeItem(at: url.appendingPathExtension("content-type"))
        }
        let random: @convention(block) (Int) -> String = { n in
            var bytes = [UInt8](repeating: 0, count: max(0, n))
            _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
            return Data(bytes).base64EncodedString()
        }
        let sha256: @convention(block) (String) -> String = { b64 in
            Data(SHA256.hash(data: Data(base64Encoded: b64) ?? Data())).base64EncodedString()
        }
        let pbkdf2: @convention(block) (String, String, Int, Int) -> String = { password, salt, iterations, bits in
            Self.pbkdf2(password: Data(base64Encoded: password) ?? Data(), salt: Data(base64Encoded: salt) ?? Data(), iterations: iterations, bytes: bits / 8)
                .base64EncodedString()
        }
        let log: @convention(block) (String, String) -> Void = { level, message in
            #if DEBUG
            if level == "error" || level == "warn" { print("[Batzio on this device] \(level): \(message)") }
            #endif
        }
        let respond: @convention(block) (String, String) -> Void = { [weak self] id, response in
            self?.answers[id] = response
        }
        set("query", query)
        set("batch", batch)
        set("fileGet", fileGet)
        set("filePut", filePut)
        set("fileDelete", fileDelete)
        set("random", random)
        set("sha256", sha256)
        set("pbkdf2", pbkdf2)
        set("log", log)
        set("respond", respond)
        return host
    }

    private func database(_ binding: String) throws -> SQLiteConnection {
        if let db = databases[binding] { return db }
        let name = binding == "DB" ? "control" : binding.replacingOccurrences(of: "TENANT_DB_", with: "tenant-")
        guard name.range(of: #"^(control|tenant-\d{3})$"#, options: .regularExpression) != nil else {
            throw SQLiteConnection.Failure(description: "Unknown database \(binding)")
        }
        let db = try SQLiteConnection(path: directory.appendingPathComponent("\(name).sqlite").path)
        databases[binding] = db
        return db
    }

    /// Storage keys look like `<tenant>/<uuid>/<name>`; every segment is kept to safe characters.
    private func fileURL(_ key: String) -> URL? {
        let segments = key.split(separator: "/").map { segment in
            segment.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-_."))) ?? ""
        }
        guard !segments.isEmpty, !segments.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else { return nil }
        return segments.reduce(directory.appendingPathComponent("files")) { $0.appendingPathComponent($1) }
    }

    private static func encode(_ work: () throws -> Any) -> String {
        let value: Any
        do { value = try work() } catch { value = ["error": "\(error)"] }
        guard let data = try? JSONSerialization.data(withJSONObject: value) else { return #"{"error":"Could not encode the result."}"# }
        return String(decoding: data, as: UTF8.self)
    }

    private static func pbkdf2(password: Data, salt: Data, iterations: Int, bytes: Int) -> Data {
        var out = [UInt8](repeating: 0, count: bytes)
        password.withUnsafeBytes { pw in
            salt.withUnsafeBytes { s in
                _ = CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2), pw.baseAddress?.assumingMemoryBound(to: Int8.self), password.count,
                    s.baseAddress?.assumingMemoryBound(to: UInt8.self), salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), UInt32(iterations), &out, bytes
                )
            }
        }
        return Data(out)
    }
}
