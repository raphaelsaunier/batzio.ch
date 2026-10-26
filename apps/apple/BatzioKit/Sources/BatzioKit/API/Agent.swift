import Foundation

/// One line of Batzi's NDJSON stream (`POST /api/agent`).
public enum AgentEvent: Sendable, Equatable {
    case thread(String)
    case text(String)
    case update(String, start: Bool)
    case tool(ToolOutcome)
    case done(refused: Bool)
    case error(String)

    private struct Raw: Decodable {
        let type: String
        let threadId: String?
        let delta: String?
        let text: String?
        let start: Bool?
        let outcome: ToolOutcome?
        let refused: Bool?
        let message: String?
    }

    /// Parses one NDJSON line; unknown event types are skipped.
    public static func parse(_ line: some StringProtocol) -> AgentEvent? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty, let raw = try? JSONDecoder().decode(Raw.self, from: Data(trimmed.utf8)) else { return nil }
        switch raw.type {
        case "thread": return raw.threadId.map(AgentEvent.thread)
        case "text": return .text(raw.delta ?? "")
        case "update": return .update(raw.text ?? "", start: raw.start ?? false)
        case "tool": return raw.outcome.map(AgentEvent.tool)
        case "done": return .done(refused: raw.refused ?? false)
        case "error": return .error(raw.message ?? "")
        default: return nil
        }
    }
}

public struct AgentRequest: Encodable, Sendable {
    public struct Confirm: Encodable, Sendable {
        public let toolUseId: String
        public let approve: Bool
        public init(toolUseId: String, approve: Bool) {
            self.toolUseId = toolUseId
            self.approve = approve
        }
    }
    public var threadId: String?
    public var text: String?
    public var fileIds: [Int]?
    public var inboxIds: [Int]?
    public var page: String?
    public var locale: String?
    public var confirm: Confirm?

    public init(threadId: String? = nil, text: String? = nil, fileIds: [Int]? = nil, inboxIds: [Int]? = nil, page: String? = nil, locale: String? = nil, confirm: Confirm? = nil) {
        self.threadId = threadId
        self.text = text
        self.fileIds = fileIds
        self.inboxIds = inboxIds
        self.page = page
        self.locale = locale
        self.confirm = confirm
    }
}

public extension APIClient {
    /// Streams Batzi's work as it happens: text, progress, tool outcomes.
    func agent(_ body: AgentRequest) -> AsyncThrowingStream<AgentEvent, Error> {
        var r = request("POST", "/api/agent")
        r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        r.setValue("application/x-ndjson", forHTTPHeaderField: "Accept")
        r.timeoutInterval = 600
        var body = body
        body.locale = body.locale ?? locale
        r.httpBody = try? Self.encoder.encode(body)
        let request = r
        let session = self.session
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                        var data = Data()
                        for try await b in bytes { data.append(b) }
                        let message = (try? JSONDecoder().decode([String: [String: String]].self, from: data))?["error"]?["message"]
                        throw APIError(status: http.statusCode, code: "agent", message: message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode), fields: nil)
                    }
                    for try await line in bytes.lines {
                        if let event = AgentEvent.parse(line) { continuation.yield(event) }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error is APIError ? error : APIError.transport(error))
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
