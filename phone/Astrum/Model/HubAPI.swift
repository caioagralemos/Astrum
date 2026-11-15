// The hub's HTTP routes the phone calls (hub/core/server.ts and main.ts).
// Every call runs and decodes off the main actor; a refusal comes back with
// the hub's own words, a network failure as `unreachable`.

import Foundation

enum HubError: Error, Sendable {
    /// The hub answered and said no, in its words.
    case refused(String)
    /// The hub could not be reached.
    case unreachable
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

    /// POST /api/blood: typed results, all or nothing.
    @concurrent
    func postBlood(person: String, values: [String: Double]) async throws {
        struct Body: Encodable { let person: String; let values: [String: Double] }
        try await post("/api/blood", body: Body(person: person, values: values))
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

    /// POST /api/earth/messages.
    @concurrent
    func postEarth(from person: String, text: String) async throws {
        struct Body: Encodable { let from: String; let text: String }
        try await post("/api/earth/messages", body: Body(from: person, text: text))
    }

    // MARK: Asking

    /// POST /api/ask: newline-delimited JSON, status lines then one result.
    func ask(person: String, question: String, lang: String) -> AsyncThrowingStream<AskEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    struct Body: Encodable { let person: String; let question: String; let lang: String }
                    var request = URLRequest(url: url("/api/ask"), timeoutInterval: 180)
                    request.httpMethod = "POST"
                    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try JSONEncoder().encode(Body(person: person, question: question, lang: lang))
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
            throw HubError.refused(Self.hubWords(data) ?? String(status))
        }
        return data
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

struct AskResult: Decodable, Sendable, Hashable {
    struct Check: Decodable, Sendable, Hashable { let discarded: Bool }

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
}

/// NASA's words, quoted unchanged with their source.
struct Passage: Decodable, Sendable, Hashable {
    let name: String
    let url: String
    let text: String
}

/// The hub-written answer (engine/answer.ts).
struct HubAnswer: Decodable, Sendable, Hashable {
    let items: [FactItem]
    let passages: [Passage]
    let factsText: String
}

struct FactItem: Decodable, Sendable, Hashable {
    struct Part: Decodable, Sendable, Hashable {
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
struct FactValue: Decodable, Sendable, Hashable {
    let text: String

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let number = try? container.decode(Double.self) {
            text = number.rounded() == number ? String(Int64(number)) : String(number)
        } else {
            text = (try? container.decode(String.self)) ?? ""
        }
    }
}

/// A steps card as the medical lead wrote it, in one language (CardView in cards.ts).
struct CardView: Decodable, Sendable, Hashable, Identifiable {
    let id: String
    let lang: String
    let title: String
    let level: String
    let messageHouston: Bool
    let steps: [String]
    let doNot: [String]
    let unverified: [String]
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
