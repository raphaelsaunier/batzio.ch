import Foundation

public struct APIError: Error, LocalizedError, Sendable {
    public let status: Int
    public let code: String
    public let message: String
    public let fields: [String: String]?

    public init(status: Int, code: String, message: String, fields: [String: String]?) {
        self.status = status
        self.code = code
        self.message = message
        self.fields = fields
    }

    public var errorDescription: String? { message }
    public var isUnauthorized: Bool { status == 401 }

    static func transport(_ error: Error) -> APIError {
        APIError(status: 0, code: "offline", message: L("Batzio can’t be reached. Check your connection and the server address."), fields: nil)
    }
}

private struct Envelope<T: Decodable>: Decodable { let data: T }
private struct ErrorEnvelope: Decodable {
    struct Body: Decodable { let code: String; let message: String; let fields: [String: String]? }
    let error: Body
}

/// A file to upload (attachments, drops, bank statements).
public struct UploadFile: Sendable {
    public let name: String
    public let mimeType: String
    public let data: Data
    public init(name: String, mimeType: String, data: Data) {
        self.name = name
        self.mimeType = mimeType
        self.data = data
    }
}

/// Carries requests to Batzio: a server over the network (`URLSession`) or the
/// engine running on this device (``LocalEngine``).
public protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, URLResponse)
}

extension URLSession: HTTPTransport {
    public func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await data(for: request)
    }
}

/// Talks to a Batzio server: `Authorization: Bearer <session>`, `X-Tenant` for
/// the chosen company and `Accept-Language` so every text comes back translated.
public struct APIClient: Sendable {
    public var baseURL: URL
    public var token: String?
    public var tenant: String?
    public var locale: String
    public var mode: String
    let transport: any HTTPTransport

    public init(baseURL: URL, token: String? = nil, tenant: String? = nil, locale: String = "en", mode: String = "simple", transport: any HTTPTransport = URLSession.shared) {
        self.baseURL = baseURL
        self.token = token
        self.tenant = tenant
        self.locale = locale
        self.mode = mode
        self.transport = transport
    }

    public static let decoder = JSONDecoder()
    public static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.withoutEscapingSlashes]
        return e
    }()

    /// Absolute URL for a server path such as `/api/v1/invoices/3/pdf`.
    public func url(_ path: String, query: [String: String?] = [:]) -> URL {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let base = components.path.hasSuffix("/") ? String(components.path.dropLast()) : components.path
        components.path = base + path
        var items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
        items.append(URLQueryItem(name: "locale", value: locale))
        components.queryItems = items
        return components.url!
    }

    /// "Batzio-iOS/0.1.0 (Version 26.0 …)": the audit log shows which app made a change.
    public static let userAgent: String = {
        #if os(macOS)
        let platform = "macOS"
        #elseif os(visionOS)
        let platform = "visionOS"
        #else
        var size = 0
        sysctlbyname("hw.machine", nil, &size, nil, 0)
        var machine = [CChar](repeating: 0, count: max(size, 1))
        sysctlbyname("hw.machine", &machine, &size, nil, 0)
        let model = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] ?? String(cString: machine)
        let platform = model.hasPrefix("iPad") ? "iPadOS" : "iOS"
        #endif
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        return "Batzio-\(platform)/\(version) (\(ProcessInfo.processInfo.operatingSystemVersionString))"
    }()

    public func request(_ method: String, _ path: String, query: [String: String?] = [:]) -> URLRequest {
        var r = URLRequest(url: url(path, query: query))
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue(locale, forHTTPHeaderField: "Accept-Language")
        r.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        // A write sent twice (a retry after a dropped connection) is answered once.
        if method != "GET" { r.setValue(UUID().uuidString, forHTTPHeaderField: "Idempotency-Key") }
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let tenant { r.setValue(tenant, forHTTPHeaderField: "X-Tenant") }
        r.timeoutInterval = 60
        return r
    }

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            do {
                (data, response) = try await transport.send(request)
            } catch let error as URLError where request.value(forHTTPHeaderField: "Idempotency-Key") != nil && Self.retryable.contains(error.code) {
                // Safe to send again: the same key makes the server answer the first attempt.
                try await Task.sleep(for: .seconds(1))
                (data, response) = try await transport.send(request)
            }
        } catch let error as SQLiteConnection.Failure {
            throw APIError(status: 500, code: "local", message: error.description, fields: nil)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError(status: 0, code: "invalid", message: "Invalid response", fields: nil) }
        guard (200..<300).contains(http.statusCode) else {
            if let e = try? Self.decoder.decode(ErrorEnvelope.self, from: data) {
                throw APIError(status: http.statusCode, code: e.error.code, message: e.error.message, fields: e.error.fields)
            }
            throw APIError(status: http.statusCode, code: "http_\(http.statusCode)", message: HTTPURLResponse.localizedString(forStatusCode: http.statusCode), fields: nil)
        }
        return (data, http)
    }

    static let retryable: Set<URLError.Code> = [.timedOut, .networkConnectionLost, .notConnectedToInternet, .cannotConnectToHost]

    func decode<T: Decodable>(_ data: Data) throws -> T {
        do {
            return try Self.decoder.decode(Envelope<T>.self, from: data).data
        } catch {
            throw APIError(status: 0, code: "decode", message: "\(error)", fields: nil)
        }
    }

    /// `GET /api/v1{path}` → `data`.
    public func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        let (data, _) = try await perform(request("GET", "/api/v1" + path, query: query))
        return try decode(data)
    }

    /// `POST`/`PATCH`/`DELETE /api/v1{path}` with a JSON body → `data`.
    public func send<T: Decodable, B: Encodable>(_ method: String, _ path: String, body: B, query: [String: String?] = [:]) async throws -> T {
        var r = request(method, "/api/v1" + path, query: query)
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.httpBody = try Self.encoder.encode(body)
        let (data, _) = try await perform(r)
        return try decode(data)
    }

    public func send<T: Decodable>(_ method: String, _ path: String) async throws -> T {
        try await send(method, path, body: [String: JSONValue]())
    }

    /// Raw bytes (PDF, XLSX, file downloads) with the server's suggested file name.
    public func download(_ path: String, query: [String: String?] = [:]) async throws -> (data: Data, filename: String, mimeType: String) {
        var r = request("GET", path.hasPrefix("/api/") ? path : "/api/v1" + path, query: query)
        r.setValue("*/*", forHTTPHeaderField: "Accept")
        let (data, http) = try await perform(r)
        let name = Self.filename(fromDisposition: http.value(forHTTPHeaderField: "Content-Disposition") ?? "") ?? (path.split(separator: "/").last.map(String.init) ?? "download")
        return (data, name, http.mimeType ?? "application/octet-stream")
    }

    /// The file name of a `Content-Disposition` header, preferring the exact UTF-8 one (`filename*=`).
    public static func filename(fromDisposition header: String) -> String? {
        if let range = header.range(of: #"filename\*=UTF-8''([^;]+)"#, options: [.regularExpression, .caseInsensitive]) {
            let value = header[range].split(separator: "'", maxSplits: 2).last.map(String.init) ?? ""
            if let decoded = value.removingPercentEncoding, !decoded.isEmpty { return decoded }
        }
        guard let range = header.range(of: #"filename="?([^";]+)"?"#, options: .regularExpression) else { return nil }
        return String(header[range]).replacingOccurrences(of: "filename=", with: "").replacingOccurrences(of: "\"", with: "")
    }

    /// Multipart upload (`/api/drop`, `/api/v1/files/upload`).
    public func upload<T: Decodable>(_ path: String, files: [UploadFile], fileField: String = "files", fields: [String: String] = [:], query: [String: String?] = [:]) async throws -> T {
        var form = MultipartForm()
        for (k, v) in fields { form.add(name: k, value: v) }
        for f in files { form.add(name: fileField, file: f) }
        var r = request("POST", path.hasPrefix("/api/") ? path : "/api/v1" + path, query: query)
        r.setValue(form.contentType, forHTTPHeaderField: "Content-Type")
        r.httpBody = form.finish()
        r.timeoutInterval = 300
        let (data, _) = try await perform(r)
        return try decode(data)
    }

    /// Raw body upload (bank statements as XML/CSV text).
    public func sendRaw<T: Decodable>(_ path: String, body: Data, contentType: String, query: [String: String?] = [:]) async throws -> T {
        var r = request("POST", "/api/v1" + path, query: query)
        r.setValue(contentType, forHTTPHeaderField: "Content-Type")
        r.httpBody = body
        let (data, _) = try await perform(r)
        return try decode(data)
    }
}

/// Builds `multipart/form-data` bodies.
struct MultipartForm {
    let boundary = "batzio-\(UUID().uuidString)"
    private var body = Data()

    var contentType: String { "multipart/form-data; boundary=\(boundary)" }

    mutating func add(name: String, value: String) {
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"\r\n\r\n\(value)\r\n")
    }

    mutating func add(name: String, file: UploadFile) {
        let safe = file.name.replacingOccurrences(of: "\"", with: "'")
        body.append("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(name)\"; filename=\"\(safe)\"\r\nContent-Type: \(file.mimeType)\r\n\r\n")
        body.append(file.data)
        body.append("\r\n")
    }

    mutating func finish() -> Data {
        body.append("--\(boundary)--\r\n")
        return body
    }
}

private extension Data {
    mutating func append(_ string: String) { append(Data(string.utf8)) }
}
