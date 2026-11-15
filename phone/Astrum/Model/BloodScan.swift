// Reads the blood analyser's results screen (Abbott i-STAT 1 and i-STAT
// Alinity) from the text lines found in a photo of it. Pure: lines in, one
// reading per hub entry out. No I/O, no Vision, no UI, so it is tested on its
// own (see phone/README.md).
//
// The screens, from Abbott's manuals: the i-STAT 1 prints one result per row,
// label and small unit on the left, the number on the right ("Na mmol/L 141",
// "Hct %PCV 41", "pH 7.461"), with an arrow after the number when it is
// outside an action range. The i-STAT Alinity draws a tile per result, "Na,
// mmol/L" with the number under it. Both write "***" when a sensor's signal
// is uncharacteristic, "<>" when a result cannot be calculated, and "<" or ">"
// before a number outside what the analyser can measure.
//
// Rules: a number is taken only from beside its label (same row) or right under
// it (the Alinity tile); it must parse cleanly and fall inside the analyser's
// own reportable range (a plausibility limit against misreads, not a medical
// range); its unit must be the hub's. A flagged value, another unit or anything
// unclear is never filled in, and nothing is ever converted or completed.

import Foundation

enum BloodScan {
    /// One piece of recognised text and where it sits, as a fraction of the
    /// photo (0 to 1), origin top left.
    struct Line: Hashable, Sendable {
        var text: String
        var x: Double
        var y: Double
        var width: Double
        var height: Double
        /// Vision's next guesses for the same text, best first.
        var alternatives: [String] = []

        var midY: Double { y + height / 2 }
        var maxX: Double { x + width }
        var maxY: Double { y + height }
    }

    /// What the photo gave for one hub entry.
    enum Reading: Hashable, Sendable {
        /// A clean number beside its label, in the hub's unit. `text` is the
        /// number exactly as read; `unitSeen` the unit as read when it was not
        /// letter for letter the expected one.
        case read(value: Double, text: String, unitSeen: String?)
        /// A clean number beside its label, but its unit could not be read.
        /// Only for tests where no other unit the analyser offers could give
        /// a number that passes the same checks (Analyte.unitInferable): the
        /// hub's unit is shown for the person to check, not claimed as read.
        case readWithoutUnit(value: Double, text: String)
        /// The analyser marked the value (`shown`: "***", "<>", "<15", "7.2↑"...).
        case flagged(shown: String)
        /// A number in another unit than the hub's. Never converted.
        case otherUnit(shown: String, unit: String)
        /// Found, but not taken.
        case unclear(Problem)
        case notFound
    }

    enum Problem: Hashable, Sendable {
        /// The number is outside what the analyser can show (`limits`, hub unit).
        case implausible(shown: String, limits: ClosedRange<Double>)
        /// The value's text is not a clean number.
        case unreadable(shown: String)
        /// More decimals than the analyser shows: a mark after the number (an
        /// arrow) may have been read as a digit ("7.2↑" as "7.21").
        case extraDigit(shown: String)
        /// The unit beside the label could not be read.
        case noUnit
        /// Two labels or two numbers compete: which belongs to which is unsure.
        case ambiguous
        /// Astrum has no plausibility limits for the hub's unit for this test.
        case unknownUnit
        /// Fewer decimals than the analyser always shows: a digit or the point was lost.
        case missingDigit(shown: String)
        /// Vision also read the same text as another plausible number.
        case uncertainDigit(shown: String)
        /// Looks at the screen read different numbers for it.
        case disagree
        /// A number read too few times to be offered.
        case notSteady(shown: String)
    }

    /// Reads each wanted hub entry (`id`, the hub's `unit`) from the lines.
    /// Entries Astrum has no analyser label for come back `.notFound`.
    static func read(_ lines: [Line], wanted: [(id: String, unit: String)]) -> [String: Reading] {
        let found = locate(lines)
        var out: [String: Reading] = [:]
        for (id, unit) in wanted {
            guard let analyte = analytes.first(where: { $0.id == id }) else { out[id] = .notFound; continue }
            let hits = found.filter { $0.analyte == id }
            switch hits.count {
            case 0: out[id] = .notFound
            case 1: out[id] = judge(hits[0], analyte: analyte, hubUnit: unit)
            default: out[id] = .unclear(.ambiguous)
            }
        }
        return out
    }

    // MARK: The analyser's words

    /// How the analyser labels each hub entry, for short progress lists.
    static func shortLabel(_ id: String) -> String {
        ["sodium": "Na", "potassium": "K", "ionized-calcium": "iCa", "glucose": "Glu", "ph": "pH",
         "hematocrit": "Hct", "hemoglobin": "Hb"][id] ?? id
    }

    struct Analyte: Sendable {
        let id: String
        /// The label at the start of a line, with the misreads seen in tests ("Gl U", "GIu", "lCa").
        let label: String
        /// Every unit the analyser can be set to show this test in (i-STAT 1
        /// System Manual, Set Units table). "" is "no unit".
        let units: [String]
        /// Whether a clean number whose unit was not read can be offered in
        /// the hub's unit: true only when every other unit the analyser can be
        /// set to either writes the same number or cannot pass the same range
        /// and decimals checks.
        let unitInferable: Bool
        /// Per unit the hub may record it in: the analyser's reportable range
        /// (it cannot show a plain number outside it) and the most decimals
        /// its screens show. Plausibility limits only, not medical ranges.
        let limits: [String: Limit]
    }

    struct Limit: Hashable, Sendable {
        let range: ClosedRange<Double>
        let decimals: Int
        /// The screens always show exactly `decimals` (K "3.0", never "3"):
        /// fewer means a digit or the point was lost ("4.5" read as "5").
        let exact: Bool
        init(_ range: ClosedRange<Double>, decimals: Int, exact: Bool = false) {
            self.range = range; self.decimals = decimals; self.exact = exact
        }
    }

    /// The hub's seven blood entries (hub/medical/blood.json ids). Ranges:
    /// the reportable ranges in Abbott's i-STAT 1 tables. Decimals: what
    /// Abbott's example screens show (Na 141, 139, 129; K 4.5, 3.1, 3.0;
    /// Glu 106, 274, 468; Hct 41, 40; pH 7.461; iCa 0.94 and 1.2), taken as
    /// exact where every example agrees; hemoglobin's one decimal is not seen
    /// on a screen.
    static let analytes: [Analyte] = [
        // mEq/L is the same number as mmol/L for sodium and potassium (one charge).
        Analyte(id: "sodium", label: #"Na"#, units: ["mmol/L", "mEq/L"], unitInferable: true,
                limits: ["mmol/L": Limit(100...180, decimals: 0, exact: true)]),
        Analyte(id: "potassium", label: #"K"#, units: ["mmol/L", "mEq/L"], unitInferable: true,
                limits: ["mmol/L": Limit(2.0...9.0, decimals: 1, exact: true)]),
        Analyte(id: "ionized-calcium", label: #"[iIl1|¡(]?Ca"#, units: ["mmol/L", "mEq/L", "mg/dL"],
                // mEq/L (twice the number) and mg/dL overlap mmol/L's range and decimals.
                unitInferable: false,
                limits: ["mmol/L": Limit(0.25...2.50, decimals: 2), "mg/dL": Limit(1.0...10.0, decimals: 1)]),
        Analyte(id: "glucose", label: #"G[lI1|] ?[uU]"#, units: ["mg/dL", "mmol/L", "g/L"],
                // mmol/L shows a decimal and g/L two; mg/dL shows none.
                unitInferable: true,
                limits: ["mg/dL": Limit(20...700, decimals: 0, exact: true), "mmol/L": Limit(1.1...38.9, decimals: 1),
                         "g/L": Limit(0.20...7.00, decimals: 2)]),
        Analyte(id: "ph", label: #"[pP][hH]"#, units: [""], unitInferable: false,
                limits: ["pH units": Limit(6.50...8.20, decimals: 3, exact: true)]),
        // 15 to 75 in the manual; one source in blood.json says 10, the wider is kept.
        Analyte(id: "hematocrit", label: #"H[cC][tT]"#, units: ["%PCV", ""],
                // The other way is a fraction (0.41), below the range.
                unitInferable: true,
                limits: ["%PCV": Limit(10...75, decimals: 0, exact: true)]),
        // Calculated by the analyser as hematocrit x 0.34, so its limits follow the hematocrit's.
        Analyte(id: "hemoglobin", label: #"H[bB]\*?|Hgb"#, units: ["g/dL", "mmol/L", "g/L"],
                // mmol/L (3.2 to 15.8, one decimal) overlaps g/dL.
                unitInferable: false,
                limits: ["g/dL": Limit(3.4...25.5, decimals: 1)]),
    ]

    /// Labels of the other results the same cartridges print. Only used to
    /// tell where one result ends and the next begins.
    private static let otherLabels = #"BUN|Urea|Crea|Cl|CI|C1|TCO2|TCO₂|AnGap|PCO2|PCO₂|PO2|PO₂|HCO3|HCO₃|BE(?:ecf|b)?|sO2|sO₂|Lac|ACT|PT|INR"#

    // MARK: Finding labels and numbers

    private struct Hit {
        let analyte: String
        /// The unit text read with the label ("" if none).
        let unit: String
        /// The value's text, or nil when no number was found for the label.
        let value: String?
        let ambiguous: Bool
        /// The value as Vision's other guesses read it.
        var otherValues: [String] = []
    }

    private static let labelPattern: NSRegularExpression = {
        let ours = analytes.map { "(?<\(group($0.id))>\($0.label))" }.joined(separator: "|")
        // A label stands alone: not followed by more letters, unless they start a unit ("Hct%PCV", "Kmmol/L").
        return try! NSRegularExpression(pattern: #"^\s*(?:"# + ours + "|(?<other>" + otherLabels + #"))(?=$|[^A-Za-z]|m(?!e)|g/)"#)
    }()

    private static func group(_ id: String) -> String { "a" + id.replacingOccurrences(of: "-", with: "") }

    /// A line's label (one of ours, or "" for another result's), the rest of its text, or nil.
    private static func label(of line: Line) -> (analyte: String, rest: String)? {
        let text = line.text
        let range = NSRange(text.startIndex..., in: text)
        guard let match = labelPattern.firstMatch(in: text, range: range),
              let whole = Range(match.range, in: text) else { return nil }
        let rest = String(text[whole.upperBound...])
        for analyte in analytes where match.range(withName: group(analyte.id)).location != NSNotFound {
            return (analyte.id, rest)
        }
        return ("", rest)
    }

    private struct Parts {
        var unit = ""
        var values: [String] = []
        /// Another label inside the same line ("Na 141 K 4.2").
        var secondLabel = false
    }

    /// Splits what follows a label into its unit and its number(s). Lone
    /// punctuation (the bar graph's ticks read as "." or ",") is dropped.
    private static func parts(_ rest: String) -> Parts {
        var parts = Parts()
        var unitWords: [String] = []
        for raw in rest.split(whereSeparator: { $0 == " " || $0 == "\t" }) {
            var word = String(raw)
            if word.allSatisfy({ ".,:;|_-–'`".contains($0) }) || word == "*" { continue }
            word = word.trimmingCharacters(in: CharacterSet(charactersIn: ",;:"))
            if looksLikeValue(word) {
                parts.values.append(word)
            } else if !parts.values.isEmpty, label(of: Line(text: word, x: 0, y: 0, width: 0, height: 0)) != nil {
                parts.secondLabel = true
            } else if parts.values.isEmpty {
                unitWords.append(word)
            } else {
                // Letters after the number: an arrow or a mark read as letters ("7.2t").
                parts.values[parts.values.count - 1] += word
            }
        }
        parts.unit = unitWords.joined()
        return parts
    }

    /// A word that is a value or stands where a value would: it starts with a
    /// digit, or is one of the analyser's marks ("***", "<>", "<15", "7.2↑").
    /// "mmo1/L" and "*PCV" (a misread "%PCV") are units.
    private static func looksLikeValue(_ word: String) -> Bool {
        word.first?.isNumber == true || word.first == "<" || word.first == ">"
            || (word.count >= 2 && word.allSatisfy { $0 == "*" })
            || word.contains(where: { arrows.contains($0) })
    }

    private static let arrows: Set<Character> = ["↑", "↓", "⬆", "⬇", "▲", "▼", "↥", "↧", "⇧", "⇩"]

    /// A line that holds only a value (no letters other than a misread mark after a number).
    private static func valueOnly(_ line: Line) -> String? {
        guard label(of: line) == nil else { return nil }
        let p = parts(line.text)
        guard p.unit.isEmpty, p.values.count == 1, !p.secondLabel else { return nil }
        return p.values[0]
    }

    /// Every label of ours on the photo, with the number beside or under it.
    private static func locate(_ lines: [Line]) -> [Hit] {
        let labelled = lines.enumerated().compactMap { i, line in label(of: line).map { (i, $0.analyte, $0.rest) } }
        let labelLines = Set(labelled.map(\.0))

        // Lines holding only a value, and which labels could own each.
        var claims: [Int: [Int]] = [:]   // value line -> label lines
        var candidate: [Int: Int] = [:]  // label line -> value line
        for (i, analyte, rest) in labelled where !analyte.isEmpty {
            let p = parts(rest)
            if !p.values.isEmpty { continue }   // the number is on the label's own line
            // The tile layout first: a number right under its label is never another row's.
            if let j = under(i, in: lines) ?? beside(i, in: lines, labels: labelLines) {
                candidate[i] = j
                claims[j, default: []].append(i)
            }
        }

        var hits: [Hit] = []
        for (i, analyte, rest) in labelled where !analyte.isEmpty {
            var p = parts(rest)
            var ambiguous = p.secondLabel || p.values.count > 1
            var others = lines[i].alternatives.compactMap { label(of: Line(text: $0, x: 0, y: 0, width: 0, height: 0)).flatMap { parts($0.rest).values.first } }
            if p.values.isEmpty, let j = candidate[i] {
                p.values = [valueOnly(lines[j])!]
                ambiguous = (claims[j]?.count ?? 0) > 1
                others = lines[j].alternatives.compactMap { valueOnly(Line(text: $0, x: 0, y: 0, width: 0, height: 0)) }
                // A unit printed as its own piece between the label and the number.
                if p.unit.isEmpty { p.unit = unitBetween(lines[i], lines[j], in: lines) }
            }
            hits.append(Hit(analyte: analyte, unit: p.unit, value: p.values.first, ambiguous: ambiguous, otherValues: others))
        }
        return hits
    }

    /// The nearest value-only line to the right on the same row, with no other
    /// label in between on the label's row or the number's.
    private static func beside(_ i: Int, in lines: [Line], labels: Set<Int>) -> Int? {
        let label = lines[i]
        // Ends right of the label: a big number's box can start under the label's unit.
        let row = lines.indices.filter { $0 != i && sameRow(lines[$0], label) && lines[$0].maxX > label.maxX + label.height }
        guard let j = row.filter({ valueOnly(lines[$0]) != nil }).min(by: { lines[$0].x < lines[$1].x }) else { return nil }
        let between = labels.contains { k in
            k != i && lines[k].x > label.x && lines[k].x < lines[j].x && (sameRow(lines[k], label) || sameRow(lines[k], lines[j]))
        }
        return between ? nil : j
    }

    /// The value-only line right under the label, starting where the label starts (the Alinity tile).
    private static func under(_ i: Int, in lines: [Line]) -> Int? {
        let label = lines[i]
        let below = lines.indices.filter { j in
            let line = lines[j]
            guard j != i else { return false }
            let gap = line.y - label.maxY
            return gap > -label.height * 0.3 && gap < label.height * 1.2
                && abs(line.x - label.x) < label.height * 1.5
                && !sameRow(line, label)
        }
        guard let j = below.min(by: { lines[$0].y < lines[$1].y }), valueOnly(lines[j]) != nil else { return nil }
        return j
    }

    private static func sameRow(_ a: Line, _ b: Line) -> Bool {
        let overlap = min(a.maxY, b.maxY) - max(a.y, b.y)
        return overlap >= 0.5 * min(a.height, b.height)
    }

    private static func unitBetween(_ label: Line, _ value: Line, in lines: [Line]) -> String {
        guard sameRow(label, value) else { return "" }
        return lines.filter { sameRow($0, label) && $0.x > label.maxX - 0.001 && $0.maxX < value.x + 0.001 && !$0.text.contains(where: \.isNumber) }
            .sorted { $0.x < $1.x }
            .map { $0.text.trimmingCharacters(in: CharacterSet(charactersIn: " ,")) }
            .joined()
    }

    // MARK: Judging one hit

    private static func judge(_ hit: Hit, analyte: Analyte, hubUnit: String) -> Reading {
        if hit.ambiguous { return .unclear(.ambiguous) }
        guard let shown = hit.value else { return .notFound }
        if flagged(shown) { return .flagged(shown: shown) }
        guard let limit = analyte.limits[hubUnit] else { return .unclear(.unknownUnit) }

        let expected = printedUnit(hubUnit)
        let unitRead = hit.unit.trimmingCharacters(in: CharacterSet(charactersIn: " ,"))
        let unitSeen: String?
        var unitWasRead = true
        switch unitMatch(unitRead, expected: expected, options: analyte.units) {
        case .exact: unitSeen = nil
        case .close: unitSeen = unitRead
        case .other(let unit): return .otherUnit(shown: shown, unit: unit)
        case .unsure:
            return .unclear(.noUnit)
        case .none:
            if expected.isEmpty { return .unclear(.unreadable(shown: unitRead + " " + shown)) }
            guard analyte.unitInferable else { return .unclear(.noUnit) }
            unitSeen = nil
            unitWasRead = false
        }

        guard let value = number(shown) else { return .unclear(.unreadable(shown: shown)) }
        guard limit.range.contains(value) else { return .unclear(.implausible(shown: shown, limits: limit.range)) }
        if decimals(shown) > limit.decimals { return .unclear(.extraDigit(shown: shown)) }
        if limit.exact, decimals(shown) < limit.decimals { return .unclear(.missingDigit(shown: shown)) }
        // Vision's other guesses for the same text: one that is another clean number means a digit is in doubt.
        if hit.otherValues.contains(where: { other in number(other).map { $0 != value && limit.range.contains($0) } ?? false }) {
            return .unclear(.uncertainDigit(shown: shown))
        }
        let clean = shown.replacingOccurrences(of: ",", with: ".")
        return unitWasRead ? .read(value: value, text: clean, unitSeen: unitSeen) : .readWithoutUnit(value: value, text: clean)
    }

    private static func flagged(_ shown: String) -> Bool {
        shown.contains("*") || shown.contains("<") || shown.contains(">") || shown.contains(where: { arrows.contains($0) })
    }

    /// A clean decimal: digits, at most one "." or "," followed by digits. Nothing else.
    static func number(_ text: String) -> Double? {
        guard text.range(of: #"^\d{1,4}(?:[.,]\d{1,4})?$"#, options: .regularExpression) != nil else { return nil }
        return Double(text.replacingOccurrences(of: ",", with: "."))
    }

    /// How many digits follow the decimal point or comma.
    static func decimals(_ text: String) -> Int {
        guard let separator = text.firstIndex(where: { $0 == "." || $0 == "," }) else { return 0 }
        return text.distance(from: separator, to: text.endIndex) - 1
    }

    /// The unit the analyser prints for the hub's unit: pH is printed with none.
    private static func printedUnit(_ hubUnit: String) -> String {
        hubUnit == "pH units" ? "" : hubUnit
    }

    /// `none`: nothing like any unit was read; `unsure`: something close to another unit was.
    private enum UnitMatch { case exact, close, other(String), unsure, none }

    /// Compares the unit as read with the expected one. Read characters OCR
    /// confuses (1, I, | for l; 0 for o) are folded first. One wrong or missing
    /// letter is accepted only when no other unit this test can be shown in is
    /// as close: that tells which of the analyser's few units it is, it never
    /// changes the number.
    private static func unitMatch(_ read: String, expected: String, options: [String]) -> UnitMatch {
        let r = fold(read), e = fold(expected)
        if r == e { return .exact }
        if r.isEmpty { return .none }
        let others = options.filter { fold($0) != e && !$0.isEmpty }
        if let other = others.first(where: { fold($0) == r }) { return .other(other) }
        if !e.isEmpty, distance(r, e) == 1, others.allSatisfy({ distance(r, fold($0)) > 1 }) { return .close }
        if let other = others.first(where: { distance(r, fold($0)) == 1 }),
           distance(r, e) > 1, others.filter({ distance(r, fold($0)) <= 1 }).count == 1 { return .other(other) }
        if others.contains(where: { distance(r, fold($0)) <= 1 }) { return .unsure }
        return .none
    }

    private static func fold(_ unit: String) -> String {
        var out = ""
        for c in unit.lowercased() where c != " " {
            switch c {
            case "1", "i", "|": out.append("l")
            case "0": out.append("o")
            case "µ": out.append("u")
            case "x" where out.isEmpty, "*" where out.isEmpty: out.append("%")  // "%PCV" read as "XPCV" or "*PCV"
            default: out.append(c)
            }
        }
        return out
    }

    /// Levenshtein distance, for the few short unit strings.
    private static func distance(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var previous = Array(0...b.count)
        for i in 1...a.count {
            var current = [i] + Array(repeating: 0, count: b.count)
            for j in 1...b.count {
                current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
            }
            previous = current
        }
        return previous[b.count]
    }
}
