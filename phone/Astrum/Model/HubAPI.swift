// The hub's HTTP routes the phone calls (hub/core/server.ts and main.ts).
// Every call runs and decodes off the main actor; a refusal comes back with
// the hub's own words, a network failure as `unreachable`. The hub's words are
// for logs and Settings, never for an alert screen (AppModel+Companion.swift).

import Foundation

enum HubError: Error, Sendable {
    /// The hub answered and said no, in its words.
    case refused(String)
    /// The hub could not be reached.
    case unreachable
    /// The alert has no question (or level 3) waiting any more: answered, escalated or ended. Refresh, do not show it.
    case notWaiting
    /// A recorded story is playing: its alerts are not in the hub's alert engine.
    case recorded
}

struct HubAPI: Sendable {
    let address: HubAddress

    // MARK: Reading

    /// GET /api/rows: one person's or one room's rows, oldest first.
    @concurrent
    func rows(person: String? = nil, room: String? = nil, signal: String? = nil, from: Double? = nil, limit: Int = 50_000) async throws -> [Row] {
        var query = [URLQueryItem(name: "limit", value: String(limit))]
        if let person { query.append(URLQueryItem(name: "person", value: person)) }
        if let room { query.append(URLQueryItem(name: "room", value: room)) }
        if let signal { query.append(URLQueryItem(name: "signal", value: signal)) }
        if let from { query.append(URLQueryItem(name: "from", value: String(Int64(from)))) }
        struct Reply: Decodable { let rows: [Row] }
        let reply: Reply = try await get("/api/rows", query: query)
        return reply.rows
    }

    /// GET /api/blood: the medical lead's entries and everyone's newest results.
    @concurrent
    func blood() async throws -> BloodReply {
        try await get("/api/blood")
    }

    /// GET /api/ask/status: whether the model is ready.
    @concurrent
    func askStatus() async throws -> AskStatus {
        try await get("/api/ask/status")
    }

    /// GET /api/cards: the approved steps cards, in this language where they have it.
    @concurrent
    func cards(lang: String) async throws -> CardsReply {
        try await get("/api/cards", query: [URLQueryItem(name: "lang", value: lang)])
    }

    // MARK: Writing

    /// POST /api/checkin. The hub stamps the answers with its own clock and labels them Reported.
    @concurrent
    func checkin(person: String, answers: [CheckinAnswer]) async throws {
        struct Body: Encodable { let person: String; let answers: [CheckinAnswer] }
        try await post("/api/checkin", body: Body(person: person, answers: answers))
    }

    /// POST /api/readings, for check-ins answered offline: they keep the time they were answered.
    @concurrent
    func readings(source: String, rows: [ReportedRow]) async throws {
        struct Body: Encodable { let source: String; let rows: [ReportedRow] }
        try await post("/api/readings", body: Body(source: source, rows: rows))
    }

    /// POST /api/blood: typed results, all or nothing. `fromPhoto` names the
    /// values read from a photo of the analyser's screen and checked by the
    /// person; the hub stores those as such.
    @concurrent
    func postBlood(person: String, values: [String: Double], fromPhoto: [String] = []) async throws {
        struct Body: Encodable { let person: String; let values: [String: Double]; let from_photo: [String]? }
        try await post("/api/blood", body: Body(person: person, values: values, from_photo: fromPhoto.isEmpty ? nil : fromPhoto))
    }

    /// POST /api/alerts/answer: "ok" or "help" to "Are you OK?".
    @concurrent
    func answerAlert(id: String, answer: String) async throws {
        struct Body: Encodable { let id: String; let answer: String }
        try await post("/api/alerts/answer", body: Body(id: id, answer: answer))
    }

    /// POST /api/alerts/acknowledge: "I've seen it" on a level 3.
    @concurrent
    func acknowledgeAlert(id: String, by person: String) async throws {
        struct Body: Encodable { let id: String; let by: String }
        try await post("/api/alerts/acknowledge", body: Body(id: id, by: person))
    }

    /// POST /api/stays: the owner entered a room (`room`) or left for nowhere known (nil), measured, at `t` on the hub's clock.
    @concurrent
    func postStay(person: String, room: String?, t: Int64, source: String) async throws {
        struct Body: Encodable {
            let person: String; let room: String?; let t: Int64; let kind: String; let source: String
            // `room` goes out as null when leaving, never left out.
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(person, forKey: .person)
                try c.encode(room, forKey: .room)
                try c.encode(t, forKey: .t)
                try c.encode(kind, forKey: .kind)
                try c.encode(source, forKey: .source)
            }
            enum CodingKeys: String, CodingKey { case person, room, t, kind, source }
        }
        try await post("/api/stays", body: Body(person: person, room: room, t: t, kind: "measured", source: source))
    }

    /// POST /api/earth/messages.
    @concurrent
    func postEarth(from person: String, text: String) async throws {
        struct Body: Encodable { let from: String; let text: String }
        try await post("/api/earth/messages", body: Body(from: person, text: text))
    }

    // MARK: Asking

    /// POST /api/ask: newline-delimited JSON, status lines then one result.
    /// `history` is this crewmate's last exchanges, oldest first (AskThread.history): the hub
    /// reads only their topic, and only when it has lost its own thread.
    func ask(person: String, question: String, lang: String, history: [AskHistoryItem] = []) -> AsyncThrowingStream<AskEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    var request = URLRequest(url: url("/api/ask"), timeoutInterval: 180)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try Self.askBody(person: person, question: question, lang: lang, history: history)
                    let (bytes, response) = try await Self.session.bytes(for: request)
                    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                    for try await line in bytes.lines where !line.isEmpty {
                        let data = Data(line.utf8)
                        if status != 200 {
                            throw HubError.refused(Self.hubWords(data) ?? String(status))
                        }
                        continuation.yield(try Self.askEvent(data))
                    }
                    continuation.finish()
                } catch let error as HubError {
                    continuation.finish(throwing: error)
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: HubError.unreachable)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    /// POST /api/ask with `stepsDone`: the owner went through a card's steps (Done). Astra's next message, one result line.
    @concurrent
    func stepsDone(person: String, card: String, lang: String) async throws -> AskResult {
        struct Body: Encodable { let person: String; let stepsDone: String; let lang: String }
        var request = URLRequest(url: url("/api/ask"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(person: person, stepsDone: card, lang: lang))
        let data = try await send(request)
        let line = data.split(separator: UInt8(ascii: "\n")).last.map { Data($0) } ?? data
        guard case .result(let result) = try Self.askEvent(line) else {
            throw HubError.refused(String(localized: "The hub sent something the app cannot read."))
        }
        return result
    }

    /// POST /api/ask/help: "Call for help" in the chat. Everyone is told, as after "I need help". Returns the hub's line.
    @concurrent
    func askForHelp(person: String, lang: String) async throws -> String {
        struct Body: Encodable { let person: String; let lang: String }
        struct Reply: Decodable { let text: String }
        var request = URLRequest(url: url("/api/ask/help"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(Body(person: person, lang: lang))
        let data = try await send(request)
        guard let reply = try? JSONDecoder().decode(Reply.self, from: data) else {
            throw HubError.refused(String(localized: "The hub sent something the app cannot read."))
        }
        return reply.text
    }

    /// The hub reads at most 10,000 bytes of a body: the oldest history goes first until it fits.
    private static func askBody(person: String, question: String, lang: String, history: [AskHistoryItem]) throws -> Data {
        struct Body: Encodable { let person: String; let question: String; let lang: String; let history: [AskHistoryItem] }
        var history = Array(history.suffix(AskHistoryItem.maxItems))
        var data = try JSONEncoder().encode(Body(person: person, question: question, lang: lang, history: history))
        while data.count > 9_000 && !history.isEmpty {
            history.removeFirst()
            data = try JSONEncoder().encode(Body(person: person, question: question, lang: lang, history: history))
        }
        return data
    }

    private static func askEvent(_ data: Data) throws -> AskEvent {
        struct Line: Decodable { let type: String?; let state: String?; let position: Int?; let ms: Double?; let error: String? }
        let line = try JSONDecoder().decode(Line.self, from: data)
        if let error = line.error { throw HubError.refused(error) }
        if line.type == "status" {
            return line.state == "queued" ? .queued(position: line.position ?? 0) : .working(seconds: Int((line.ms ?? 0) / 1000))
        }
        return .result(try JSONDecoder().decode(AskResult.self, from: data))
    }

    // MARK: Plumbing

    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 20
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()

    private func url(_ path: String, query: [URLQueryItem] = []) -> URL {
        var parts = URLComponents()
        parts.scheme = "http"
        parts.host = address.host
        parts.port = address.port
        parts.path = path
        if !query.isEmpty { parts.queryItems = query }
        // Built from a checked host and a fixed path, so it is always a URL.
        return parts.url ?? URL(string: "http://localhost")!
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await send(URLRequest(url: url(path, query: query)))
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw HubError.refused(String(localized: "The hub sent something the app cannot read."))
        }
    }

    private func post<B: Encodable>(_ path: String, body: B) async throws {
        var request = URLRequest(url: url(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        _ = try await send(request)
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await Self.session.data(for: request)
        } catch {
            throw HubError.unreachable
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            switch Self.hubCode(data) {
            case "not-waiting": throw HubError.notWaiting
            case "recorded": throw HubError.recorded
            default: throw HubError.refused(Self.hubWords(data) ?? String(status))
            }
        }
        return data
    }

    /// The `code` the hub puts in some refusals, so the app can act on them.
    private static func hubCode(_ data: Data) -> String? {
        struct Refusal: Decodable { let code: String? }
        return (try? JSONDecoder().decode(Refusal.self, from: data))?.code
    }

    /// The `error` the hub puts in a refusal.
    private static func hubWords(_ data: Data) -> String? {
        struct Refusal: Decodable { let error: String }
        return (try? JSONDecoder().decode(Refusal.self, from: data))?.error
    }
}

// MARK: Bodies and replies

/// One check-in answer: 1/0 for yes/no, 0 to 100 for a slider, or a text.
struct CheckinAnswer: Codable, Sendable, Hashable {
    let signal: String
    let value: Double?
    var text: String? = nil
    let unit: String
}

/// A Reported row sent through /api/readings (an offline check-in).
struct ReportedRow: Codable, Sendable, Hashable {
    let t: Int64
    let signal: String
    let value: Double?
    let text: String?
    let unit: String
    var kind = "reported"
    let person: String
}

struct AskStatus: Decodable, Sendable, Hashable {
    /// "ready", "loading" or "unavailable".
    let state: String
    let reason: String?
    let waiting: Int
}

enum AskEvent: Sendable {
    case queued(position: Int)
    case working(seconds: Int)
    case result(AskResult)
}

/// Codable so Ask Astra's thread can keep answers on the phone as the hub sent them.
struct AskResult: Codable, Sendable, Hashable {
    struct Check: Codable, Sendable, Hashable { let discarded: Bool }
    /// The question the hub asks back, in the asker's language, and the check-in signal its answer goes to.
    struct FollowUp: Codable, Sendable, Hashable { let question: String; let signal: String }
    /// The medical lead's ask-first rule: an intro and its questions, each yes/no or a typed value.
    struct AskFirst: Codable, Sendable, Hashable {
        struct Words: Codable, Sendable, Hashable { let en: String; let pt: String }
        struct Question: Codable, Sendable, Hashable { let signal: String; let kind: String }
        let intro: Words
        let questions: [Question]
    }

    /// "answer", "crisis", "card", "fixed", "unavailable" or "fallback".
    let route: String
    /// "model", "hub" or "fixed".
    let by: String
    let text: String
    /// A fixed text's key in the hub's string table.
    let key: String?
    let source: String?
    let passages: [Passage]
    let card: CardView?
    let urgent: Bool
    let check: Check?
    let facts: HubAnswer?
    let ms: Double
    var followUp: FollowUp? = nil
    var askFirst: AskFirst? = nil
    /// The complete question the hub made of a message that leaned on the one before ("and yesterday?").
    var understoodAs: String? = nil
    /// A question Astra asks back and waits on; the next message is read against it first.
    var pendingQuestion: PendingQuestion? = nil
    /// Set when the message was small talk, answered by the hub's own sentence.
    var smallTalk: String? = nil
    /// Set when the message was a remark or reaction ("I thought so"), answered by the hub's own sentence.
    var remark: String? = nil
    /// Why this reply reads as it does ("model", "setAside", "hub", "smallTalk", "remark", …).
    var reason: String? = nil
    /// Astra's opening sentence and who wrote it ("model": passed every check; "fixed": the hub's line).
    /// Already at the start of `text`; shown above the facts when the phone draws them instead of `text`.
    var lead: Lead? = nil
    /// The quiet help line after a crisis phrase earlier in the thread. Already at the end of `text`;
    /// shown under the facts or under the phone's own fixed text.
    var aside: String? = nil
    /// A typed "yes" to "Do you want to call for help?": "Call for help" is offered under this reply.
    var offerHelp: Bool? = nil

    struct Lead: Codable, Sendable, Hashable {
        let text: String
        /// "model" or "fixed".
        let by: String
    }

    /// A question Astra asked back (PendingQuestion in core/ai.ts), in the asker's language.
    struct PendingQuestion: Codable, Sendable, Hashable {
        struct Option: Codable, Sendable, Hashable { let value: String; let label: String }
        /// "askFirst", "card", "better", "clarify", "note", "feeling" or "offerHelp" (its "help" option confirms and calls).
        let purpose: String
        /// "yes_no", "value" or "choice".
        let kind: String
        let text: String
        let options: [Option]
        var unit: String? = nil
    }
}

/// NASA's words, quoted unchanged with their source.
struct Passage: Codable, Sendable, Hashable {
    let name: String
    let url: String
    let text: String
}

/// The hub-written answer (engine/answer.ts).
struct HubAnswer: Codable, Sendable, Hashable {
    let items: [FactItem]
    let passages: [Passage]
    let factsText: String
}

struct FactItem: Codable, Sendable, Hashable {
    struct Part: Codable, Sendable, Hashable {
        let what: String
        let kind: Kind
    }

    let key: String
    let vars: [String: FactValue]
    /// A kind, or "hub" for the hub's own rule.
    let label: String
    let labels: [Part]?
}

/// A sentence's blank: the hub sends numbers and words.
struct FactValue: Codable, Sendable, Hashable {
    let text: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) {
            text = number.rounded() == number ? String(Int64(number)) : String(number)
        } else {
            text = (try? container.decode(String.self)) ?? ""
        }
    }

    /// Kept as words: a saved number reads back as the same text.
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(text)
    }
}

/// A steps card as the medical lead wrote it, in one language (CardView in cards.ts).
struct CardView: Codable, Sendable, Hashable, Identifiable {
    let id: String
    let lang: String
    let title: String
    let level: String
    let messageHouston: Bool
    let steps: [String]
    let doNot: [String]
    /// Her own list of the parts not checked against a source. It does not mean the card is unapproved.
    let unverified: [String]
    /// Who approved it: always "medical_lead", since only approved cards are sent. Nil from an older hub.
    var approvedBy: String? = nil
    /// Where it applies: "weightless", "partial_gravity", "earth_gravity". Nil: everywhere, or an older hub.
    var appliesIn: [String]? = nil
}

struct CardsReply: Decodable, Sendable, Hashable {
    struct OtherLanguage: Decodable, Sendable, Hashable { let id: String }

    let lang: String
    let cards: [CardView]
    let otherLanguageOnly: [OtherLanguage]
    let problems: [String]
}

struct BloodReply: Decodable, Sendable, Hashable {
    let entries: [BloodEntry]
    let problems: [String]
    let latest: [String: [BloodResult]]
}

struct BloodEntry: Decodable, Sendable, Hashable, Identifiable {
    struct Names: Decodable, Sendable, Hashable { let en: String; let pt: String }
    struct Range: Decodable, Sendable, Hashable { let low: Double?; let high: Double? }

    let id: String
    let name: Names
    let unit: String
    let reference_range: Range
}

struct BloodResult: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    let row: Row
    /// "no-range", "in-range", "below", "above", "urgent-below" or "urgent-above".
    let judgement: String
    let unitMatches: Bool
}
