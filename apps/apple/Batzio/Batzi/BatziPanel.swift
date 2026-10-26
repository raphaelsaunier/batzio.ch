import BatzioKit
import PhotosUI
import SwiftUI

struct BatziPanel: View {
    @Environment(AppModel.self) private var app
    @State private var text = ""
    @State private var importing = false
    @State private var photos: [PhotosPickerItem] = []
    #if os(iOS)
    @State private var scanning = false
    #endif
    @FocusState private var focused: Bool

    private var batzi: BatziModel { app.batzi }

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if batzi.messages.isEmpty { intro }
                        ForEach(batzi.messages) { MessageView(message: $0).id($0.id) }
                    }
                    .padding()
                }
                .onChange(of: batzi.messages.last?.text) {
                    if let last = batzi.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
            }
            composer
        }
        .background(Color.bzBackground)
        .fileImporter(isPresented: $importing, allowedContentTypes: dropTypes, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            let files = ItemLoader.uploads(from: urls)
            Task { await batzi.attach(files.uploads) }
        }
        .onChange(of: photos) {
            let items = photos
            photos = []
            Task {
                var files: [UploadFile] = []
                for (i, item) in items.enumerated() {
                    if let data = try? await item.loadTransferable(type: Data.self) {
                        files.append(UploadFile(name: "photo-\(i + 1).jpg", mimeType: "image/jpeg", data: data))
                    }
                }
                await batzi.attach(files)
            }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $scanning) {
            DocumentScanner { file in Task { await batzi.attach([file.upload]) } }.ignoresSafeArea()
        }
        #endif
        .onDrop(of: dropTypes, isTargeted: nil) { providers in
            Task { await batzi.attach(await ItemLoader.uploads(from: providers).uploads) }
            return true
        }
    }

    private var header: some View {
        HStack {
            Image("CoinFront").resizable().frame(width: 28, height: 28)
            Text("Batzi").font(.bzDisplay(20))
            Spacer()
            Menu {
                Button(L("New chat"), systemImage: "plus") { batzi.newChat() }
                if !batzi.threads.isEmpty {
                    Section(L("Recent")) {
                        ForEach(batzi.threads.prefix(12)) { t in
                            Button(t.title) { Task { await batzi.load(thread: t.id) } }
                        }
                    }
                }
            } label: {
                Image(systemName: "clock.arrow.circlepath")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .task { await batzi.loadThreads() }
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("Hi, I’m Batzi.")).font(.bzDisplay(22))
            Text(L("Tell me what happened, drop a receipt or ask about your numbers. I keep the books, you keep your sanity.")).font(.bzBody(14)).foregroundStyle(.secondary)
            FlowLayout {
                ForEach(app.bootstrap?.examples ?? [], id: \.self) { e in
                    Button(e) { text = e; focused = true }.buttonStyle(.neuCompact)
                }
            }
            if !(app.bootstrap?.agent ?? false) {
                Label(L("Batzi needs an Anthropic API key on the server before it can chat. Quick sentences and file drops still work."), systemImage: "key")
                    .font(.bzBody(13))
                    .foregroundStyle(Color.bzWarning)
            }
        }
        .neuCard()
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !batzi.attachments.isEmpty || batzi.uploading {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack {
                        ForEach(batzi.attachments) { f in
                            Label(f.name, systemImage: "paperclip").font(.bzBody(12)).padding(.horizontal, 8).padding(.vertical, 4).background(Capsule().fill(Color.bzSecondary))
                        }
                        if batzi.uploading { ProgressView().controlSize(.small) }
                    }
                }
            }
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button(L("Choose files"), systemImage: "doc") { importing = true }
                    #if os(iOS)
                    if DocumentScanner.isAvailable { Button(L("Scan a document"), systemImage: "doc.viewfinder") { scanning = true } }
                    #endif
                } label: {
                    Image(systemName: "paperclip").font(.title3)
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
                PhotosPicker(selection: $photos, maxSelectionCount: 10, matching: .images) {
                    Image(systemName: "photo").font(.title3)
                }
                .buttonStyle(.plain)
                TextField(L("Ask Batzi anything…"), text: $text, axis: .vertical)
                    .lineLimit(1...6)
                    .textFieldStyle(.roundedBorder)
                    .focused($focused)
                    .onSubmit(send)
                Button(action: send) { Image(systemName: "arrow.up.circle.fill").font(.title2) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color.bzPrimary)
                    .disabled(batzi.working || (text.trimmingCharacters(in: .whitespaces).isEmpty && batzi.attachments.isEmpty))
                    .keyboardShortcut(.return, modifiers: .command)
            }
        }
        .padding()
    }

    private func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty || !batzi.attachments.isEmpty, !batzi.working else { return }
        text = ""
        Task { await batzi.send(t) }
    }
}

private struct MessageView: View {
    @Environment(AppModel.self) private var app
    let message: BatziModel.Message

    var body: some View {
        VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 6) {
            if !message.updates.isEmpty && message.streaming {
                Label(message.updates.last ?? "", systemImage: "gearshape.2").font(.bzBody(12)).foregroundStyle(.secondary)
            }
            if !message.files.isEmpty {
                ForEach(message.files) { Label($0.name, systemImage: "paperclip").font(.bzBody(12)).foregroundStyle(.secondary) }
            }
            if !message.text.isEmpty || message.streaming {
                Group {
                    if message.text.isEmpty { ProgressView().controlSize(.small) } else {
                        Text((try? AttributedString(markdown: message.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(message.text))
                            .textSelection(.enabled)
                    }
                }
                .font(.bzBody(15))
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(message.role == "user" ? Color.bzPrimary.opacity(0.14) : Color.bzCard)
                )
            }
            ForEach(message.tools) { ToolOutcomeView(tool: $0) }
            if message.refused {
                Text(L("Batzi declined this one.")).font(.bzBody(12)).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: message.role == "user" ? .trailing : .leading)
    }
}

private struct ToolOutcomeView: View {
    @Environment(AppModel.self) private var app
    let tool: ToolOutcome

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: tool.pending ?? false ? "hand.raised.fill" : tool.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                    .foregroundStyle(tool.pending ?? false ? Color.bzWarning : tool.ok ? Color.bzSuccess : Color.bzDestructive)
                Text(tool.title).font(.bzBody(13, weight: .semibold))
            }
            if let summary = tool.summary { Text(summary).font(.bzBody(13)).foregroundStyle(.secondary) }
            HStack {
                if let record = tool.record {
                    Button(record.label ?? L("Open")) { app.open(record) }.buttonStyle(.neuCompact)
                }
                if tool.pending ?? false {
                    Button(L("Yes, do it")) { Task { await app.batzi.confirm(tool, approve: true) } }.buttonStyle(NeuButtonStyle(prominent: true, compact: true))
                    Button(L("No")) { Task { await app.batzi.confirm(tool, approve: false) } }.buttonStyle(.neuCompact)
                }
            }
        }
        .padding(12)
        .neuCard(cornerRadius: 14, padding: 0)
    }
}
