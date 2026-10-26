import BatzioKit
import SwiftUI

/// A conversation with Batzi, streamed live from `/api/agent`.
@Observable @MainActor
final class BatziModel {
    struct Message: Identifiable, Equatable {
        let id = UUID()
        let role: String
        var text: String
        var files: [FileRef] = []
        var updates: [String] = []
        var tools: [ToolOutcome] = []
        var refused = false
        var streaming = false
    }

    weak var app: AppModel?
    var messages: [Message] = []
    var threadId: String?
    var working = false
    var attachments: [FileRef] = []
    var uploading = false
    var threads: [ThreadSummary] = []

    func reset() {
        messages = []
        threadId = nil
        attachments = []
        working = false
    }

    func newChat() { reset() }

    func load(thread id: String) async {
        guard let app else { return }
        do {
            let turns: [ChatTurn] = try await app.api.get("/app/threads/\(id)")
            threadId = id
            messages = turns.map { Message(role: $0.role, text: $0.text, files: $0.files ?? [], updates: $0.updates ?? [], tools: $0.tools ?? [], refused: $0.refused ?? false) }
        } catch {
            app.report(error)
        }
    }

    func loadThreads() async {
        guard let app else { return }
        threads = (try? await app.api.get("/app/threads")) ?? []
    }

    /// Uploads files to attach to the next message.
    func attach(_ files: [UploadFile]) async {
        guard let app, !files.isEmpty else { return }
        uploading = true
        defer { uploading = false }
        do {
            let stored: [StoredFile] = try await app.api.upload("/api/drop", files: files, query: ["store": "1"])
            attachments += stored.map(\.file)
        } catch {
            app.report(error)
        }
    }

    func send(_ text: String) async {
        let files = attachments
        attachments = []
        messages.append(Message(role: "user", text: text, files: files))
        await stream(AgentRequest(threadId: threadId, text: text, fileIds: files.map(\.id), page: app?.currentPage))
    }

    /// Lets Batzi take care of an inbox item (a dropped file or forwarded mail).
    func process(fileId: Int?, inboxId: Int?, prompt: String?) async {
        let text = prompt ?? L("Take care of this, please.")
        messages.append(Message(role: "user", text: text))
        await stream(AgentRequest(threadId: threadId, text: text, fileIds: fileId.map { [$0] }, inboxIds: inboxId.map { [$0] }, page: app?.currentPage))
    }

    func confirm(_ tool: ToolOutcome, approve: Bool) async {
        await stream(AgentRequest(threadId: threadId, confirm: .init(toolUseId: tool.id, approve: approve)))
    }

    private func stream(_ request: AgentRequest) async {
        guard let app else { return }
        working = true
        messages.append(Message(role: "assistant", text: "", streaming: true))
        let index = messages.count - 1
        defer {
            if messages.indices.contains(index) { messages[index].streaming = false }
            working = false
            app.changed()
        }
        do {
            for try await event in app.api.agent(request) {
                switch event {
                case .thread(let id): threadId = id
                case .text(let delta): messages[index].text += delta
                case .update(let text, _): messages[index].updates.append(text)
                case .tool(let outcome):
                    if let i = messages[index].tools.firstIndex(where: { $0.id == outcome.id }) { messages[index].tools[i] = outcome } else { messages[index].tools.append(outcome) }
                case .done(let refused): messages[index].refused = refused
                case .error(let message):
                    messages[index].text += message != "no_agent" ? message
                        : app.prefs.isOnDevice ? L("Batzi needs an internet connection. On this device, quick sentences and file drops still work.")
                        : L("Batzi needs an Anthropic API key on the server before it can chat. Quick sentences and file drops still work.")
                }
            }
        } catch {
            messages[index].text += error.localizedDescription
        }
    }
}
