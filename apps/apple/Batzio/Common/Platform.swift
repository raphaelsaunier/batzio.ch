import BatzioKit
import SwiftUI
import UniformTypeIdentifiers
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

enum Clipboard {
    @MainActor static func copy(_ text: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = text
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

extension URL {
    var mimeType: String { UTType(filenameExtension: pathExtension)?.preferredMIMEType ?? "application/octet-stream" }
}

extension View {
    /// Inline titles where the platform has them.
    func inlineTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    func numericKeyboard() -> some View {
        #if os(iOS)
        keyboardType(.decimalPad)
        #else
        self
        #endif
    }

    func emailKeyboard() -> some View {
        #if os(iOS)
        keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        self
        #endif
    }

    func plainInput() -> some View {
        #if os(iOS)
        textInputAutocapitalization(.never).autocorrectionDisabled()
        #else
        autocorrectionDisabled()
        #endif
    }

    /// Sheets get a sensible size on the Mac.
    func sheetFrame() -> some View {
        #if os(macOS)
        frame(minWidth: 520, idealWidth: 620, minHeight: 460, idealHeight: 640)
        #else
        self
        #endif
    }
}

/// Where the trailing toolbar buttons go on each platform.
extension ToolbarItemPlacement {
    static var bzTrailing: ToolbarItemPlacement {
        #if os(macOS)
        .primaryAction
        #else
        .topBarTrailing
        #endif
    }
}

/// Reads dropped or pasted items into uploads.
enum ItemLoader {
    @MainActor static func uploads(from providers: [NSItemProvider]) async -> [UploadFileBox] {
        var out: [UploadFileBox] = []
        for provider in providers {
            let type = provider.registeredContentTypes.first { $0.conforms(to: .data) || $0.conforms(to: .fileURL) } ?? .data
            let suggested = provider.suggestedName
            let file: UploadFileBox? = await withCheckedContinuation { continuation in
                _ = provider.loadFileRepresentation(for: type, openInPlace: false) { url, _, _ in
                    guard let url, let data = try? Data(contentsOf: url) else {
                        continuation.resume(returning: nil)
                        return
                    }
                    let ext = url.pathExtension
                    let name = suggested.map { ext.isEmpty || $0.hasSuffix(".\(ext)") ? $0 : "\($0).\(ext)" } ?? url.lastPathComponent
                    continuation.resume(returning: UploadFileBox(name: name, mimeType: url.mimeType, data: data))
                }
            }
            if let file { out.append(file) }
        }
        return out
    }

    static func uploads(from urls: [URL]) -> [UploadFileBox] {
        urls.compactMap { url in
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return nil }
            return UploadFileBox(name: url.lastPathComponent, mimeType: url.mimeType, data: data)
        }
    }
}

/// Sendable carrier for a file read on a background queue.
struct UploadFileBox: Sendable {
    let name: String
    let mimeType: String
    let data: Data
}

extension UploadFileBox {
    var upload: UploadFile { UploadFile(name: name, mimeType: mimeType, data: data) }
}

extension Array where Element == UploadFileBox {
    var uploads: [UploadFile] { map(\.upload) }
}

/// Drop target types for the whole window.
let dropTypes: [UTType] = [.fileURL, .pdf, .image, .commaSeparatedText, .xml, .spreadsheet, .plainText, .data]
