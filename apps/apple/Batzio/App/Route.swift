import BatzioKit
import Foundation

/// Screens pushed onto the detail stack.
enum Route: Hashable {
    case list(String)
    case record(String, Int)
    case create(String, prefill: Record?)
    case edit(String, Int)
    case report(String)
    case file(Int, String?)
    case target(AppTarget)
}

extension AppTarget {
    /// A stack route for targets that are not a top-level destination.
    var route: Route {
        switch self {
        case .resource(let name, let id, let create):
            if let id { return .record(name, id) }
            return create ? .create(name, prefill: nil) : .list(name)
        case .reports(let id?): return .report(id)
        case .file(let id): return .file(id, nil)
        default: return .target(self)
        }
    }
}
