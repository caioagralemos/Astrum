// Ask Astra: a question about yourself to the hub's model (POST /api/ask).
// The model runs on the hub, never on the phone: out of reach, asking is
// off and says why. While it works the screen says where the question is;
// then the answer (AskAnswerView).

import SwiftUI

struct AskView: View {
    @Environment(AppModel.self) private var model
    @State private var question = ""
    @State private var progress: String?
    @State private var result: AskResult?
    @State private var problem: String?
    @State private var status: AskStatus?
    @State private var showingSettings = false
    @FocusState private var typing: Bool

    private let examples: [String] = [
        String(localized: "Why do I keep waking up with a headache?"),
        String(localized: "Is the CO2 in my room dangerous?"),
        String(localized: "How much should I exercise?"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                ConnectionBanner()
                questionSection
                if result == nil && progress == nil {
                    examplesSection
                }
                if let progress {
                    Section {
                        Label { Text(progress) } icon: { ProgressView() }
                    }
                }
                if let problem {
                    Section { Text(problem).foregroundStyle(.secondary) }
                }
                if let result {
                    AskAnswerView(result: result, lang: model.lang)
                }
            }
            .navigationTitle("Ask Astra")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    SettingsButton { showingSettings = true }
                }
            }
            .sheet(isPresented: $showingSettings) { SettingsView() }
            .task(id: model.isConnected) { await pollStatus() }
        }
    }

    private var questionSection: some View {
        Section {
            TextField("Your question", text: $question, axis: .vertical)
                .lineLimit(1...6)
                .focused($typing)
                .submitLabel(.send)
                .onSubmit { ask(question) }
            Button("Ask") { ask(question) }
                .disabled(!canAsk || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        } header: {
            Text(statusText)
        } footer: {
            if let reason = disabledReason {
                Text(reason)
            } else if model.lang == "pt" {
                Text("Astra writes in English.")
            }
        }
    }

    private var examplesSection: some View {
        Section("Or try one") {
            ForEach(examples, id: \.self) { example in
                Button(example) {
                    question = example
                    ask(example)
                }
                .disabled(!canAsk)
            }
        }
    }

    private var canAsk: Bool { model.isConnected && !model.person.isEmpty && progress == nil }

    private var disabledReason: String? {
        if !model.isConnected { return String(localized: "Astra runs on the hub, and the hub is out of reach. Nothing runs on this phone.") }
        if model.person.isEmpty { return String(localized: "Choose who you are in Settings first.") }
        return nil
    }

    private var statusText: String {
        guard let status, model.isConnected else { return String(localized: "Astra: out of reach") }
        let state = switch status.state {
        case "ready": String(localized: "ready")
        case "loading": String(localized: "loading")
        default: String(localized: "unavailable")
        }
        return status.waiting > 0 ? String(localized: "Astra: \(state) · \(status.waiting) in line") : String(localized: "Astra: \(state)")
    }

    private func ask(_ text: String) {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canAsk, !text.isEmpty, let api = model.api else { return }
        typing = false
        result = nil
        problem = nil
        progress = String(localized: "Sending the question…")
        Task {
            do {
                for try await event in api.ask(person: model.person, question: text, lang: model.lang) {
                    switch event {
                    case .queued(let position): progress = String(localized: "Waiting in line: position \(position)")
                    case .working(let seconds): progress = String(localized: "Astra is working: \(seconds) s")
                    case .result(let answer): result = answer
                    }
                }
            } catch HubError.refused(let words) {
                problem = String(localized: "The hub refused it: \(words)")
            } catch {
                problem = String(localized: "The hub is out of reach.")
            }
            progress = nil
        }
    }

    /// The model's state, every five seconds while this tab is open.
    private func pollStatus() async {
        while !Task.isCancelled {
            if let api = model.api, model.isConnected { status = try? await api.askStatus() }
            try? await Task.sleep(for: .seconds(5))
        }
    }
}

#Preview {
    AskView()
        .environment(SampleData.model())
        .preferredColorScheme(.dark)
}
