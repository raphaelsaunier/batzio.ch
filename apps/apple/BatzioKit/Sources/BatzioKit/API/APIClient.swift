import Foundation

public struct APIError: Error, LocalizedError, Sendable {
    public let status: Int
    public let code: String
    public let message: String
    public let fields: [String: String]?

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

/// Talks to a Batzio server: `Authorization: Bearer <session>`, `X-Tenant` for
/// the chosen company and `Accept-Language` so every text comes back translated.
public struct APIClient: Sendable {
    public var baseURL: URL
    public var token: String?
    public var tenant: String?
    public var locale: String
    public var mode: String
    let session: URLSession

    public init(baseURL: URL, token: String? = nil, tenant: String? = nil, locale: String = "en", mode: String = "simple", session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.tenant = tenant
        self.locale = locale
        self.mode = mode
        self.session = session
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

    public func request(_ method: String, _ path: String, query: [String: String?] = [:]) -> URLRequest {
        var r = URLRequest(url: url(path, query: query))
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        r.setValue(locale, forHTTPHeaderField: "Accept-Language")
        if let token { r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let tenant { r.setValue(tenant, forHTTPHeaderField: "X-Tenant") }
        r.timeoutInterval = 60
        return r
    }

    func perform(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
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
        let disposition = http.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        let name = disposition.range(of: #"filename="?([^";]+)"?"#, options: .regularExpression).map {
            String(disposition[$0]).replacingOccurrences(of: "filename=", with: "").replacingOccurrences(of: "\"", with: "")
        } ?? (path.split(separator: "/").last.map(String.init) ?? "download")
        return (data, name, http.mimeType ?? "application/octet-stream")
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
