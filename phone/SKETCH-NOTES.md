# Sketch notes: the native companion

> **Status (14 Nov)**
> - Written: all four tabs (Me, Check-in, Ask Astra, Station), full-screen alerts, first run, offline copy, String Catalog (EN + PT, 371 keys), a `#Preview` on every screen, README and these notes.
> - Type-checks: the whole app against the iOS SDK, strict concurrency, 0 errors, 0 warnings. The model code also decodes the live hub's real payloads.
> - Left: nothing in this pass. Unverified until you build: runtime layout, previews rendering, catalog keys matching Xcode's extraction.
> - Time remaining: 0 minutes. The pass is done.
> - In Xcode: open the project, let it pick up the new folders, check Portuguese shows in `Localizable.xcstrings`, open `MeView`'s preview, then run on your phone against the hub.

A first pass so you can restyle it. The structure and the data plumbing are meant to stay. The look is a placeholder: system fonts, the dark scheme, white lines, orange and red only when something is wrong, always with a word next to them.

## The flow and why

**The phone is personal.** The hub shows the station. The phone belongs to one crewmate and shows that person's body and what concerns them. So the home tab is *you*, not the station, and anything about other people is only what the hub shares on its own screens.

**Me.** Your body sits in the middle and you explore it. Five regions (head, heart, lungs and air, body and activity, blood), each tied to its readings. A region gets a mark when one of its readings is outside your usual or part of an alert. Under it, one line sums up today ("Everything within your usual", "2 readings outside your usual", or the alert), then the readings as a list. The figure is how you find things; the list is where you read them. Tapping a region filters the list. Tapping a reading opens its detail: your usual (median and spread), its history, its label and source in words, and, when the hub's evidence card covers it, what it points to. *Code:* `Screens/Me/` (`MeView`, `AvatarView`, `ReadingRow`, `ReadingDetailView`), data in `Model/Readings.swift`.

**Check-in.** This is where you enter things: the daily questions (headache yes/no; mood, stress and tiredness 0 to 100; an optional note) and the blood test entries. Only what the hub accepts. Answers come back labelled Reported. Offline, a check-in is kept on the phone and sent with the time you answered it. *Code:* `Screens/CheckIn/`.

**Ask Astra.** A Messages-style chat titled "Astra" (see "Ask Astra as a chat" below). Your questions on the right in blue, Astra's answers on the left as the hub sent them, the composer at the bottom. The model runs on the hub. Out of reach, the composer is off with the reason and the saved thread stays readable. *Code:* `Screens/Ask/`, `Model/AskThread.swift`.

**Station.** The companion's small window on the hub: the room you are in and its air (CO2 against NASA's 2.8 and 3), the crew as names, rooms and shared status, the place and mission day, and Earth (the delay, Contact Earth, messages with countdowns, the simulated reply marked Simulated). *Code:* `Screens/Station/`.

**Alerts.** Full screen over any tab, and only alerts you are told about. Level 2 about you: "Are you OK?", the countdown, two big answers. Level 3 about anyone: who, where, the number against the limit with its label, the steps card word for word (or "No steps card is approved for this yet"), Earth's countdown, "I've seen it". Once seen it can be closed and stays on Me as a banner until it ends. Level 1 is never full screen. A tapped notification opens the alert. *Code:* `Screens/Alerts/`.

**First run and Settings.** Find the hub, choose who you are, Health, notifications. Settings keeps what it had and adds language (iOS's per-app language: it follows the device unless changed in the Settings app) and "Open the hub's page", the one place the web view is still used. *Code:* `Screens/Onboarding/`, `SettingsView.swift`.

## Where the data comes from

- `Model/HubWorld.swift`: everything the socket has sent, applied the way `hub/ui/src/data.ts` applies it, on the hub's clock. Saved to disk, so Me opens offline with "Not connected · showing data from 14:05".
- `Model/Timeline.swift` and `Model/Baseline.swift`: the hub's rules ported from TypeScript. The current value: among fresh readings, measured beats estimated beats reported beats replayed beats simulated. Your usual: median and scaled MAD of your own history, the same as the hub's person view.
- `Model/HubAPI.swift`: every HTTP route, run and decoded off the main actor.
- `Preview/SampleData.swift`: the one file of sample data. Every screen has a `#Preview`. Previews only; the running app shows only what the hub sent.

## Deliberately unstyled

- **The body figure** is the hub's 3D crew avatar (`hub/ui/src/avatar/`), built into `Resources/avatar.html` by `hub/ui/src/avatar/phone.ts` and shown by `AvatarView`. Head, heart (heart view), lungs (breathing view) and body (arms, legs, pelvis) light up on the figure; blood shows the heart view's vessels without the heart. Marked regions are outlined in orange. The region row under it stays: it is the VoiceOver and Switch Control path.
- **The range bar** (`Components/RangeBar.swift`) is a hairline, a band and a dot. It has three uses: your usual, NASA's marks, a daily target.
- **The chart** is a default Swift Charts line with a band.
- **Lists and forms** are stock `List` and `Form` in the dark scheme. No custom colours, materials, spacing or type scale.
- **Alerts** are a black screen with big bordered buttons. No motion at all, so nothing needs a Reduce Motion fallback yet. If you add some, gate it.
- **Tab icons** are placeholder SF Symbols.

## The hub's icons and widgets (14 Nov)

- **Icons** (`Components/HubIcon.swift`): every icon of `hub/ui/src/person/icons.tsx` and the dock's header icons, drawn from the same SVG path data, stroked as the hub strokes them, sized with Dynamic Type, hidden from VoiceOver. Used on reading rows, the above/below-usual badges and banners (trend arrows), the widget headers and the no-reading screen. SF Symbols stay only where the hub has no icon: tabs, settings, status signs (warning, check), connection, onboarding, check-in queue, steps card.
- **Widgets** (`Components/WidgetCard.swift`, `Screens/Station/StationWidgets.swift`, `Screens/Me/MeWidgets.swift`): the dock's look, in a two-column grid (one column at accessibility sizes). Station: alerts, Earth, CO2 in every room, crew, mission, radiation (only when the hub sends radiation). Me: sleep, exercise, CO2 exposure, the owner's only. Not ported: the sensor board (the phone is not told whether a board is connected).
- **Type-check** (no build): from `phone/`, `swiftc -typecheck -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" -target arm64-apple-ios18.0 -swift-version 5 -strict-concurrency=complete $(find Astrum -name '*.swift')`

## Blood analyser from a photo (14 Nov)

- **What it is:** a camera bridge, not a connection. Photo (camera or library) → Vision on the phone → `Model/BloodScan.swift` finds the hub's seven values by the analyser's labels → a review screen where each value is confirmed or typed → `POST /api/blood` with `from_photo` (hub stores those as `istat:photo`, still `measured`). Code: `Screens/CheckIn/BloodScanView.swift`, `Model/BloodScanReader.swift`, `Model/BloodScan.swift`.
- **Why a still photo, not the live scanner:** `DataScannerViewController` needs a camera (no simulator, no library photo, no demo picture), gives no photo to check the numbers against, and hands back items without a stable layout. A still photo plus `VNRecognizeTextRequest` works from the library too, keeps the photo on screen for the check, and runs the same code in the macOS test.
- **Layouts read** (Abbott i-STAT 1 System Manual, "Interpretation of displayed results" and "Set units"; i-STAT Alinity Quick Reference Guide, results pages): i-STAT 1 rows `Na mmol/L … 141`, `Glu mg/dL`, `Hct %PCV`, `pH` with no unit, arrows after a number past an action range; Alinity tiles `Na, mmol/L` with the number under it. Both: `***`, `<>`, `<`/`>`.
- **Plausibility limits** are the analyser's reportable ranges (Na 100–180, K 2.0–9.0, iCa 0.25–2.50 mmol/L, Glu 20–700 mg/dL, pH 6.50–8.20, Hct 10–75 %PCV, Hb 3.4–25.5 g/dL), plus the most decimals its screens show (Na, Glu, Hct 0; K 1; iCa 2; pH 3; Hb 1, not seen on a screen).
- **Test without building:** compile `Model/BloodScan.swift` with a test `main.swift` for macOS (`swiftc Model/BloodScan.swift main.swift`); for real OCR also compile `Model/BloodScanReader.swift` into a small command-line reader. The pass on 14 Nov: 74 parser checks; on 10 images (Abbott's pictures and photo-like copies), 29 of 32 plain values read right, 0 wrong values filled, the flagged potassium withheld both times.
- **Only a build and a real analyser can tell:** the camera and library flow on a phone, LCD glare and the backlight, the real i-STAT label spellings (for example whether hemoglobin shows as `Hb` or `Hb*`), and the review screen's layout.
- **Keyboard (also for typed results):** previous / next / Done over the keyboard on every Check-in field and the review screen, drag down to dismiss, a tap on a field's name or caption dismisses, the focused field scrolls into view. Long names wrap; the unit is on the line under the name.

## Design references to open on your phone

- **Apple Watch / Health "Vitals"** (the overnight view). Values plotted against *your* typical range, "within/outside typical" in plain words, one line on top. *Borrow:* the range-against-yourself bar, and the calm when nothing is wrong. *Don't copy:* the nightly-only framing. Our readings arrive all day.
- **Health app, Summary and a body-measurement detail page** (e.g. Resting Heart Rate). Pinned list of latest values, then a detail page with a chart, ranges and "About". *Borrow:* the detail's order (value, chart, context) and the D/W/M range switcher if you want longer history. *Don't copy:* the colourful category tints. Our status colours mean something is wrong.
- **Fitness rings.** A daily target filled through the day. *Borrow:* a ring or bar for exercise against NASA's 1.5 hours. *Don't copy:* streaks, awards and goals the user sets. The target is NASA's, not a habit game.
- **Emergency SOS countdown and Medical ID.** Huge countdown, two unmistakable actions, information readable by someone else. *Borrow:* the type scale and the slide-or-hold patterns if you want "I need help" to be harder to hit by accident. Medical ID's plain layout fits the level 3 screen another crewmate reads. *Don't copy:* the auto-call behaviour. The hub decides who is told.
- **Check In in Messages.** "Are you OK?", a timer, and what happens if you don't answer. *Borrow:* saying up front what happens when the time runs out ("the crew is told"). *Don't copy:* the casual tone.
- **Oura's or WHOOP's daily readiness screen.** One summary up top, details below. *Borrow:* one line over the details. *Don't copy:* a single invented score. Astrum shows which readings are outside your usual and never folds them into one number.
- **Health app's Medications log** (logging a dose). *Borrow:* for Check-in, fast tap-to-answer rows and the history underneath. *Don't copy:* reminders and schedules nobody asked for.

## Open questions (yours)

1. **Figure or list first?** Does the body earn its space every day, or should it shrink once a region is picked? The plain region row under it is there for VoiceOver and might be all some people want.
2. **What sits in the middle of Me when something is wrong?** Today the summary line and the region mark. Should the most unusual reading become a hero card, as the hub's person view does?
3. **Blood as a region.** It holds lab results, not live values. Keep it on the figure, or move it to Check-in only?
4. **Check-in cadence.** Once a day, or whenever? Should Me nudge when today's check-in is missing (careful: the hub pushes nothing like that today)?
5. **Sliders' meaning.** Mood, stress and tiredness are 0 to 100 with no anchors, because the hub defines none. Do you want words at the ends ("none", "worst")? That is a medical-lead question as much as a design one.
6. **Level 3 on someone else's phone.** Full screen until seen, then a banner. Right, or should it stay full screen until it ends, as on the hub?
7. **Station's weight.** Is it a tab, or a sheet from Me? It is the least personal screen.
8. **Language.** It uses iOS's per-app language (Settings app). Do you want an in-app switch for the demo instead?
9. **Freshness.** A reading counts as current for one hour (a day and a half for daily values such as sleep). The hub's own rule for picking the current source is 30 seconds, and an Apple Watch heart rate arrives every few minutes. Do those windows feel right on screen?

## Ask Astra as a chat (14 Nov, tracker 519)

- **Look:** a 1:1 copy of the owner's Aimbot chat (`Aimbot/Views/ChatBubbles.swift`, `ChatTimes.swift`, and `MessageView`, `TypingIndicator` and the composer in `IntelligenceView.swift`), ported to iOS in `Screens/Ask/ChatBubbles.swift`: the same bubble outline with the tail on a run's last bubble (radius 17, continuous), Messages' grey (white 0.23) and blue (`systemBlue`), 12 × 7 padding, 4 between a run's bubbles and 12 between runs, a centred time ("Today 13:38") after a 15-minute gap, the three dots, the glass composer pill (an outline before iOS 26), and the example questions as suggestion pills over an empty thread. The one tab that follows Messages instead of the projection frames; the navigation bar, fonts and background stay the app's.
- **An answer** is an incoming run: Astra's or a fixed text's words as bubbles (one per paragraph), then attachments drawn like Messages' link previews: each hub fact with its label(s) and kind mark in the band under it, the steps card, NASA's quote with its source and site (a tap opens it). The hub's question back ("Did it get better?") is the last bubble, with Yes / No pills when it takes a yes or a no; the reply goes to `POST /api/checkin` (queued offline like any check-in) and shows as your blue bubble. Under the run, where Messages says "Delivered": who wrote it, the route when it is not a plain answer, "Marked urgent", and "Answered at 14:05 in 2.4 s, from the readings then".
- **Pending:** the typing dots, with the hub's real stage under them ("Sending the question…", "Waiting in line: position 2", "Astra is working: 4 s"). **Failed:** Messages' red mark beside the question, "Not Delivered" (out of reach) or "Not Answered" (the hub refused, in its words), and Try Again. One question at a time, as the hub answers one at a time.
- **Memory:** the top of the thread says once, in Messages' grey note style, that each question is answered on its own and Astra does not remember earlier messages.
- **History:** `AskThread` keeps the last 50 exchanges per crewmate in `ask-<person>.json` (`LocalStore`), answers exactly as the hub sent them (`AskResult` is now `Codable`). A question still on its way when the app closed comes back as failed, with Try Again. Clear (toolbar, with confirmation) deletes the file's contents.
- **Accessibility:** the thread reads top to bottom; your question is spoken "You asked, 14:05: …"; an answer is a container that announces when, who wrote it and the labels in words; each fact speaks its label; finished answers and failures are announced at low priority; the field is labelled; bubbles and attachments grow with Dynamic Type (labels stack at accessibility sizes, the far margin shrinks); Reduce Motion: no send motion, still dots, no animated scroll.
- **Not ported from Aimbot:** avatars and speaker names (a 1:1 chat with no face), Tapbacks, Reply and the other message actions (only Copy), the swipe-left to see each message's time (the centred times and the line under each answer carry it), voice and attachments from the composer, Return-to-send (iOS: the send button).
- **Only a build can tell:** the tail's look at real sizes, the glass pill on iOS 26 against the thread, the keyboard riding and interactive dismiss, the scroll staying at the bottom as answers arrive, and VoiceOver reading the answer container's summary.
