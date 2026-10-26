import BatzioKit
import PDFKit
import QuickLook
import SwiftUI
#if os(iOS)
import VisionKit
#endif

/// A downloaded file on disk, ready to preview or share.
struct LocalFile: Identifiable, Hashable {
    let url: URL
    var id: URL { url }
    var isPDF: Bool { url.pathExtension.lowercased() == "pdf" }

    static func write(_ data: Data, name: String) throws -> LocalFile {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("batzio", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(name.replacingOccurrences(of: "/", with: "-"))
        try data.write(to: url, options: .atomic)
        return LocalFile(url: url)
    }
}

/// Downloads a server file (PDF, XLSX, attachment) and shows it.
struct DownloadButton<Label: View>: View {
    @Environment(AppModel.self) private var app
    let path: String
    var query: [String: String?] = [:]
    @ViewBuilder let label: () -> Label
    @State private var file: LocalFile?
    @State private var busy = false

    var body: some View {
        Button {
            Task {
                busy = true
                defer { busy = false }
                do {
                    let d = try await app.api.download(path, query: query)
                    file = try LocalFile.write(d.data, name: d.filename)
                    #if os(macOS)
                    NSWorkspace.shared.open(file!.url)
                    file = nil
                    #endif
                } catch {
                    app.report(error)
                }
            }
        } label: {
            if busy { ProgressView().controlSize(.small) } else { label() }
        }
        .disabled(busy)
        .sheet(item: $file) { f in FileSheet(file: f) }
    }
}

struct FileSheet: View {
    let file: LocalFile
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if file.isPDF {
                    PDFKitView(url: file.url)
                } else {
                    #if os(macOS)
                    EmptyState(title: file.url.lastPathComponent)
                    #else
                    QuickLookView(url: file.url)
                    #endif
                }
            }
            .navigationTitle(file.url.lastPathComponent)
            .inlineTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } }
                ToolbarItem(placement: .bzTrailing) { ShareLink(item: file.url) }
            }
        }
        .sheetFrame()
    }
}

#if os(macOS)
struct PDFKitView: NSViewRepresentable {
    let url: URL
    func makeNSView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.document = PDFDocument(url: url)
        return v
    }
    func updateNSView(_ view: PDFView, context: Context) {}
}
#else
struct PDFKitView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> PDFView {
        let v = PDFView()
        v.autoScales = true
        v.backgroundColor = .clear
        v.document = PDFDocument(url: url)
        return v
    }
    func updateUIView(_ view: PDFView, context: Context) {}
}

struct QuickLookView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> QLPreviewController {
        let c = QLPreviewController()
        c.dataSource = context.coordinator
        return c
    }
    func updateUIViewController(_ controller: QLPreviewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        let url: URL
        init(url: URL) { self.url = url }
        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }
        func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem { url as NSURL }
    }
}
#endif

#if os(iOS)
/// Scans paper with the camera and hands back one PDF.
struct DocumentScanner: UIViewControllerRepresentable {
    let onScan: (UploadFileBox) -> Void
    @Environment(\.dismiss) private var dismiss

    static var isAvailable: Bool { VNDocumentCameraViewController.isSupported }

    func makeUIViewController(context: Context) -> VNDocumentCameraViewController {
        let c = VNDocumentCameraViewController()
        c.delegate = context.coordinator
        return c
    }
    func updateUIViewController(_ controller: VNDocumentCameraViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    /// VisionKit calls the delegate on the main thread.
    @MainActor final class Coordinator: NSObject, @preconcurrency VNDocumentCameraViewControllerDelegate {
        let parent: DocumentScanner
        init(parent: DocumentScanner) { self.parent = parent }

        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan) {
            let pdf = PDFDocument()
            for i in 0..<scan.pageCount {
                if let page = PDFPage(image: scan.imageOfPage(at: i)) { pdf.insert(page, at: pdf.pageCount) }
            }
            if let data = pdf.dataRepresentation() {
                let stamp = Fmt.isoString(Date())
                parent.onScan(UploadFileBox(name: "scan-\(stamp).pdf", mimeType: "application/pdf", data: data))
            }
            parent.dismiss()
        }
        func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) { parent.dismiss() }
        func documentCameraViewController(_ controller: VNDocumentCameraViewController, didFailWithError error: Error) { parent.dismiss() }
    }
}
#endif
