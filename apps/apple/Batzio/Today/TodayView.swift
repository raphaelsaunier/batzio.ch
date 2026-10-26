import BatzioKit
import Charts
import SwiftUI

struct TodayView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Loader(id: "today") { api in
            try await api.get("/app/today") as TodayScreen
        } content: { today, refresh in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header(today)
                    QuickComposer()
                    if let weather = today.weather { WeatherCard(weather: weather) }
                    if !today.nudges.isEmpty {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionTitle(text: L("Needs you"))
                            Text(L("Only what Batzi can’t decide for you.")).font(.bzBody(14)).foregroundStyle(.secondary)
                            ForEach(today.nudges) { NudgeCard(nudge: $0, refresh: refresh) }
                        }
                    } else {
                        EmptyState(title: L("All clear"), text: L("Nothing needs you right now. Go outside."))
                            .frame(maxWidth: .infinity)
                    }
                    InboxCard()
                    if !today.threads.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionTitle(text: L("Recent chats with Batzi"))
                            ForEach(today.threads.prefix(5)) { thread in
                                Button {
                                    app.showBatzi = true
                                    Task { await app.batzi.load(thread: thread.id) }
                                } label: {
                                    HStack {
                                        Image(systemName: "bubble.left.and.text.bubble.right")
                                        Text(thread.title).lineLimit(1)
                                        Spacer()
                                        Text(Fmt.date(thread.last)).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                                .buttonStyle(.plain)
                                .padding(.vertical, 4)
                            }
                        }
                        .neuCard()
                    }
                }
                .padding(24)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await refresh() }
        }
        .bzPage()
        .navigationTitle(L("Today"))
    }

    private func header(_ today: TodayScreen) -> some View {
        HStack(alignment: .center, spacing: 16) {
            Image("CoinFront")
                .resizable()
                .scaledToFit()
                .frame(width: 64, height: 64)
                .shadow(color: .black.opacity(0.2), radius: 6, y: 4)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(today.greeting), \(today.name)").font(.bzDisplay(32))
                Text(app.bootstrap?.tenant.name ?? "").font(.bzBody(15)).foregroundStyle(.secondary)
            }
        }
    }
}

struct WeatherCard: View {
    let weather: MoneyWeather

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    SectionTitle(text: L("Money weather"))
                    Text(Fmt.money(weather.cash)).font(.bzDisplay(34)).monospacedDigit()
                    Text(mood).font(.bzBody(14)).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: weather.mood == "sunny" ? "sun.max.fill" : weather.mood == "cloudy" ? "cloud.sun.fill" : "cloud.rain.fill")
                    .symbolRenderingMode(.multicolor)
                    .font(.system(size: 44))
            }
            if !weather.weeks.isEmpty {
                let points = Self.points(weather.weeks)
                let values = weather.weeks.map(\.balance)
                let lo = (values.min() ?? 0), hi = (values.max() ?? 0)
                let pad = max((hi - lo) * 0.25, abs(hi) * 0.02, 1)
                Chart(points, id: \.date) { w in
                    AreaMark(x: .value(L("Week"), w.date), yStart: .value("CHF", lo - pad), yEnd: .value("CHF", w.balance))
                        .foregroundStyle(LinearGradient(colors: [Color.bzPrimary.opacity(0.3), Color.bzPrimary.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.linear)
                    LineMark(x: .value(L("Week"), w.date), y: .value("CHF", w.balance))
                        .foregroundStyle(Color.bzPrimary)
                        .lineStyle(StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                        .interpolationMethod(.linear)
                }
                .chartYScale(domain: (lo - pad)...(hi + pad))
                .chartYAxis { AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) }
                .frame(height: 120)
            }
            HStack {
                Label("+ \(Fmt.money(weather.incoming))", systemImage: "arrow.down.left").foregroundStyle(Color.bzSuccess)
                Spacer()
                Text(L("8 weeks ahead")).foregroundStyle(.secondary)
                Spacer()
                Label("− \(Fmt.money(weather.outgoing))", systemImage: "arrow.up.right").foregroundStyle(Color.bzDestructive)
            }
            .font(.bzBody(13, weight: .medium))
        }
        .neuCard()
    }

    /// Today's cash and the end of this week share a date; spread them apart.
    static func points(_ weeks: [WeatherWeek]) -> [(date: Date, balance: Double)] {
        var out: [(date: Date, balance: Double)] = []
        for w in weeks {
            var d = Fmt.parseDate(w.week) ?? .now
            if let last = out.last?.date, d <= last { d = last.addingTimeInterval(3.5 * 86_400) }
            out.append((d, w.balance))
        }
        return out
    }

    private var mood: String {
        switch weather.mood {
        case "sunny": L("Sunny: you are covered for the next 8 weeks.")
        case "cloudy": L("Cloudy: it gets tight around {date}.", ["date": Fmt.date(weather.low.week)])
        default: L("Rain ahead: money runs short around {date}.", ["date": Fmt.date(weather.low.week)])
        }
    }
}

struct NudgeCard: View {
    @Environment(AppModel.self) private var app
    let nudge: Nudge
    let refresh: () async -> Void
    @State private var busy: String?

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            BZImage(name: nudge.icon)
                .font(.title3)
                .foregroundStyle(Tone(name: nudge.tone == "warning" ? "warning" : nudge.tone).foreground)
                .frame(width: 36, height: 36)
                .background(Circle().fill(Tone(name: nudge.tone).background))
            VStack(alignment: .leading, spacing: 8) {
                Text(nudge.title).font(.bzBody(15, weight: .semibold)).fixedSize(horizontal: false, vertical: true)
                if let text = nudge.text { Text(text).font(.bzBody(14)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
                FlowLayout(spacing: 8) {
                    ForEach(Array(nudge.actions.enumerated()), id: \.offset) { _, action in
                        if !(action.agent ?? false) || (app.bootstrap?.agent ?? false) {
                            Button {
                                Task { await run(action) }
                            } label: {
                                HStack(spacing: 6) {
                                    if busy == action.label { ProgressView().controlSize(.mini) }
                                    Text(action.label)
                                }
                            }
                            .buttonStyle(NeuButtonStyle(prominent: action.primary ?? false, compact: true))
                            .disabled(busy != nil)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
            if let amount = nudge.amount { Text(Fmt.amount(amount)).font(.bzNumber(15, weight: .semibold)) }
        }
        .neuCard()
    }

    private func run(_ action: NudgeAction) async {
        busy = action.label
        defer { busy = nil }
        do {
            switch action.kind {
            case "link":
                if let target = action.target {
                    if case .file(let id) = target { app.push(.file(id, nil)) } else { app.go(target) }
                }
            case "record_action":
                if let resource = action.resource, let id = action.id, let name = action.action {
                    let r: ActionResponse = try await app.api.send("POST", "/\(resource)/\(id)/\(name)")
                    if let m = r.message { app.toast(m) }
                    await refresh()
                }
            case "remind_overdue":
                let created: Int = try await app.api.send("POST", "/sales/reminders/run")
                app.toast(L("Reminders created: {n}", ["n": created]))
                await refresh()
            case "ask":
                app.showBatzi = true
                await app.batzi.send(action.prompt ?? action.label)
            case "process_inbox":
                app.showBatzi = true
                await app.batzi.process(fileId: action.fileId, inboxId: action.inboxId, prompt: action.prompt)
            case "dismiss_inbox":
                if let id = action.inboxId {
                    let _: JSONValue = try await app.api.send("PATCH", "/app/inbox/\(id)", body: ["status": "done"])
                    await refresh()
                }
            default:
                break
            }
        } catch {
            app.report(error)
        }
    }
}

struct InboxCard: View {
    @Environment(AppModel.self) private var app
    @State private var importing = false
    #if os(iOS)
    @State private var scanning = false
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionTitle(text: L("Inbox"))
            Text(L("Drop receipts, bills, bank statements or spreadsheets anywhere in Batzio, or forward them by email.")).font(.bzBody(14)).foregroundStyle(.secondary)
            if let address = app.bootstrap?.inbox {
                HStack {
                    Image(systemName: "envelope")
                    Text(address).font(.bzBody(14, weight: .medium)).textSelection(.enabled).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    Button(L("Copy")) { Clipboard.copy(address); app.toast(L("Copied")) }.buttonStyle(.neuCompact)
                }
            }
            HStack {
                Button { importing = true } label: { Label(L("Choose files"), systemImage: "doc.badge.plus") }.buttonStyle(.neu)
                #if os(iOS)
                if DocumentScanner.isAvailable {
                    Button { scanning = true } label: { Label(L("Scan"), systemImage: "doc.viewfinder") }.buttonStyle(.neu)
                }
                #endif
            }
        }
        .neuCard()
        .fileImporter(isPresented: $importing, allowedContentTypes: dropTypes, allowsMultipleSelection: true) { result in
            guard case .success(let urls) = result else { return }
            let files = ItemLoader.uploads(from: urls)
            Task { await app.drop(files.uploads) }
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $scanning) {
            DocumentScanner { file in Task { await app.drop([file.upload]) } }.ignoresSafeArea()
        }
        #endif
    }
}

/// Wraps buttons onto new lines.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: proposal.width, height: nil))
            if x > 0, x + size.width > width { x = 0; y += row + spacing; row = 0 }
            x += size.width + spacing
            row = max(row, size.height)
            maxX = max(maxX, x - spacing)
        }
        return CGSize(width: min(maxX, width), height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + size.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            row = max(row, size.height)
        }
    }
}
