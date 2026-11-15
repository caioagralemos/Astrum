// The hub's own sentences for Ask Astra's facts. AnswerStrings.json is
// ANSWER_STRINGS from hub/engine/answer.ts, copied as data, in English and
// Portuguese. The phone always asks about its owner, so the person words are
// always "you". To refresh it after the hub's sentences change, from hub/:
//
//   node -e "import('./engine/answer.ts').then(m => require('fs').writeFileSync('../phone/Astrum/Model/AnswerStrings.json', JSON.stringify(m.ANSWER_STRINGS, null, 1)))"

import Foundation

enum AnswerStrings {
    private static let table: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "AnswerStrings", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let table = try? JSONDecoder().decode([String: [String: String]].self, from: data) else { return [:] }
        return table
    }()

    /// personWords(who, first) in answer.ts, for someone asking about themselves.
    private static let you: [String: String] = [
        "You": "You", "you": "you", "are": "are", "Your": "Your", "your": "your", "them": "you",
        "Voce": "Você", "voce": "você", "de_voce": "de você",
    ]

    /// One fact as a sentence in the app's language, or nil if the app does not know its key.
    static func sentence(_ item: FactItem, lang: String) -> String? {
        guard let template = table[item.key]?[lang] ?? table[item.key]?["en"] else { return nil }
        var out = ""
        var rest = Substring(template)
        while let open = rest.firstIndex(of: "{"), let close = rest[open...].firstIndex(of: "}") {
            out += rest[..<open]
            let name = String(rest[rest.index(after: open)..<close])
            // A signal goes through the one naming rule: never a key, and in this language when the app knows it.
            let value = item.vars[name]?.text
            out += (name == "signal" ? value.map(Signals.inSentence) : value) ?? you[name] ?? ""
            rest = rest[rest.index(after: close)...]
        }
        return out + rest
    }
}
