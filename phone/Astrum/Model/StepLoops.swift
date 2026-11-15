// Which looping illustration goes with which step of a card: a card id and a
// step's place in it (from 0) to a loop's file name, from the medical lead's
// list of videos (NASA/steps-demo/videos-astrum.md). Only steps that list
// names a gesture for have one; every other step shows its text alone. The
// loops are bundled from steps-demo/loops, with a still (png) for each.

import Foundation

enum StepLoops {
    /// The loops the medical lead has reviewed. None yet: every loop is captioned as not reviewed.
    static let reviewed: Set<String> = []

    /// Card id → step index → the loop's name without its gravity suffix.
    static let table: [String: [Int: String]] = [
        "high-co2": [0: "V05-leave-the-room", 1: "V04-sealed-mask", 2: "V04-sealed-mask"],
        "unknown-urgent": [0: "V01-call-everyone", 1: "V08-press-with-a-cloth", 3: "V27-watch-the-chest", 6: "V28-cover-the-person"],
        "cardiac-arrest": [0: "V01-call-everyone", 1: "V12-chest-compressions-no-gravity", 2: "V13-medical-restraint"],
        "cardiac-arrest-gravity": [0: "V01-call-everyone", 1: "V10-lie-on-back-on-floor", 2: "V09-chest-compressions-with-gravity",
                                   3: "V07-bag-valve-mask", 4: "V11-defibrillator-pads"],
        "low-oxygen": [0: "V02-sit-and-stay-still", 1: "V05-leave-the-room", 2: "V04-sealed-mask", 3: "V18-look-at-the-watch"],
        "skin-rash": [0: "V15-clean-with-gauze", 3: "V14-cold-or-warm-cloth"],
        "upper-respiratory": [1: "V21-saline-nose-spray", 2: "V20-wash-hands"],
        "headache": [0: "V02-sit-and-stay-still", 1: "V17-sip-water"],
        "cut-injury": [0: "V08-press-with-a-cloth", 1: "V15-clean-with-gauze", 2: "V16-bandage", 3: "V14-cold-or-warm-cloth"],
        "chest-pain": [0: "V02-sit-and-stay-still", 3: "V18-look-at-the-watch"],
        "nausea-vomiting": [0: "V02-sit-and-stay-still", 1: "V19-vomit-bag", 2: "V17-sip-water"],
        "dizziness-fainting": [0: "V02-sit-and-stay-still", 1: "V17-sip-water", 2: "V18-look-at-the-watch"],
        "digestive": [0: "V17-sip-water", 4: "V20-wash-hands"],
        "back-pain": [1: "V30-stretch", 2: "V14-cold-or-warm-cloth"],
        "eyes": [0: "V20-wash-hands"],
        "skin-infection": [0: "V15-clean-with-gauze", 1: "V16-bandage", 2: "V29-mark-the-redness"],
        "ear-nose-throat": [0: "V31-yawn", 2: "V23-pinch-the-nose"],
        "neuro": [0: "V02-sit-and-stay-still", 2: "V24-stroke-test"],
    ]

    struct Loop: Hashable, Sendable {
        let name: String
        let video: URL
        let still: URL?
        var isReviewed: Bool { StepLoops.reviewed.contains(name) }
    }

    /// The loop for this step, in the variant for the gravity (true: gravity on), else the one that exists.
    static func loop(card: String, step: Int, gravityOn: Bool?) -> Loop? {
        guard let base = table[card]?[step] else { return nil }
        let preferred = gravityOn == false ? ["-no-gravity", "-with-gravity"] : ["-with-gravity", "-no-gravity"]
        for name in [base] + preferred.map({ base + $0 }) {
            if let video = Bundle.main.url(forResource: name, withExtension: "mp4") {
                return Loop(name: name, video: video, still: Bundle.main.url(forResource: name, withExtension: "png"))
            }
        }
        return nil
    }

    /// Gravity on or off where this card is used: the card's own "applies in" when it names one
    /// kind, else the mission's gravity. Nil when the phone does not know.
    static func gravityOn(_ card: CardView, missionGravity: Double?) -> Bool? {
        if let places = card.appliesIn, !places.isEmpty {
            if places.allSatisfy({ $0 == "weightless" }) { return false }
            if !places.contains("weightless") { return true }
        }
        guard let g = missionGravity, g.isFinite, g >= 0 else { return nil }
        return g > 0
    }
}
