# Phone

The iPhone app: a native companion to the hub. The hub shows the whole station; the phone belongs to one crewmate and shows that person's body and what concerns them. It also finds the hub on the Wi-Fi (Bonjour, or a typed address), sends the Apple Watch's Health readings to it, keeps a live socket open and turns alerts into notifications (which a locked phone passes to the Watch).

## The flow

1. First run: find the hub, choose who you are from the hub's crew, Health access, notifications.
2. **Me** (home): a body figure with five regions (head, heart, lungs and air, body and activity, blood), one line that sums up today, then every reading with its value, a bar against your own usual, and its label (Measured, Estimated, Reported, Replayed, Simulated).
3. Tap a region to filter the list; tap a reading for its detail: your usual, its history, its source, and where the hub's evidence points.
4. **Check-in**: the daily questions (headache, mood, stress, tiredness, a note) and the blood test entries, typed or read from a photo of the analyser's screen (below). Number fields have previous / next / Done over the keyboard.
5. **Ask Astra**: a question about yourself to the hub's model, answered with the hub's facts and NASA's words.
6. **Station**: your room's air, the crew by name and room, the mission day, and Earth (delay, messages, Contact Earth).
7. Alerts take over the screen above any tab: "Are you OK?" at level 2 (yours), the danger screen at level 3 (anyone). Level 1 is a quiet banner on Me.
8. Out of reach of the hub it opens on the last saved data, says so, and queues check-ins until the hub is back.
9. Settings (the gear on each tab): hub, crewmate, Health, test alert, language, and a link to the hub's own page (the only web view left).
10. Design notes and open questions: `SKETCH-NOTES.md`.

## What each tab reads and writes

| Tab | Reads | Writes |
|---|---|---|
| Me | socket `/ws` (`state`, `rows`, `stay`, `alerts`, `evidence`, `clock`...), `GET /api/rows?person=` (15 days, for your usual and the charts), `GET /api/rows?room=&signal=co2` (room chart), `GET /api/blood` | nothing |
| Check-in | `GET /api/rows?person=` (earlier check-ins), `GET /api/blood` | `POST /api/checkin`; offline check-ins later through `POST /api/readings` (kind `reported`, the time they were answered); `POST /api/blood` (with `from_photo` for values read from a photo) |
| Ask Astra | `GET /api/ask/status` every 5 s | `POST /api/ask` (newline-delimited JSON) |
| Station | the socket (stays, latest cabin rows, alarms, activity, earth messages, profile) | `POST /api/earth/messages` |
| Alerts | the socket (`alerts`, `earth`), `GET /api/cards?lang=` | `POST /api/alerts/answer`, `POST /api/alerts/acknowledge` |

The phone never shows another crewmate's readings, mood or check-ins: only names, rooms and what the hub shares (asleep, exercising, needs help), and only alerts the hub says this person is told.

## Blood results from the analyser's screen

"Scan the analyser's screen" in Check-in's blood section. It reads a screen; it is **not a data connection** to the analyser (none could be tested).

1. **Scan with the camera** (the main way): fit the i-STAT 1 or i-STAT Alinity results screen in the frame. The camera (4K where the phone has it, continuous autofocus, tap to focus, torch off) is read a few times a second inside the frame only (`Screens/CheckIn/BloodScanCamera.swift`). A value is taken when the same number has been read in 3 frames and no frame ever read a different number for it; a short list shows each value as it settles ("Na ✓ K …"). It finishes by itself, or with "Use what was read". **Choose a photo** reads one picture three ways and needs two to agree. Typing by hand stays as it was.
2. Each picture is prepared on the phone (`Model/BloodScanReader.swift`): squared up to the screen's rectangle when one is found, grey, local contrast, then Vision (accurate, no language correction) and the rows are levelled. `Model/BloodScan.swift` finds each of the hub's seven entries by the analyser's label (Na, K, iCa, Glu, pH, Hct, Hb) with the number beside it (i-STAT 1) or under it (Alinity tile). A number is used only if it is clean, inside the analyser's reportable range (a plausibility limit, not a medical range), has exactly the decimals the analyser shows, and Vision's other guesses for it do not read another number. Flagged values (`***`, `<>`, `<`, `>`, arrows), another unit (never converted) and anything unclear are left empty with the reason. A unit that could not be read is filled in the hub's unit and marked "Unit not read: check the unit on the screen", only for Na, K, Glu and Hct, where no other unit the analyser offers could pass the same checks; never for iCa, pH or Hb.
3. Review: the picture (pinch or double-tap to zoom) over one field per entry. A value read from the screen says "Read from the photo: check it" until it is confirmed or typed over; only confirmed or typed values are saved. Saved through `POST /api/blood`, all or nothing, like typed results (kind `measured`); confirmed values are stored with source `istat:photo`, the rest `istat:typed`.
4. The picture stays in that screen's memory and is gone when it closes. Nothing is recorded; nothing goes over the network but the confirmed numbers.

To try it: phone 15 to 25 cm from the screen, square to it (not at an angle), the screen filling the frame, no lamp reflected in it; hold still for 2 to 5 seconds; tap the screen once if the picture looks soft. On a Mac, show the test image at full size or larger.

Limits: measured on simulated phone photos of Abbott's own result-screen pictures shown on a monitor (`SKETCH-NOTES.md`), not on a real analyser. An arrow after a number can still be read as a digit for glucose ("60↓" as "601"). The person's check against the picture is the safeguard, by design.

## The body avatar

The figure on Me is the hub's crew avatar (`hub/ui/src/avatar/`), bundled as one offline file, `Astrum/Resources/avatar.html`. After changing the avatar, rebuild that file (it does not touch `hub/ui/dist`):

```
cd hub && node scripts/build-phone-avatar.mjs
```

The page's entry is `hub/ui/phone-avatar.html` + `hub/ui/src/avatar/phone.ts`; the Swift side is `Screens/Me/AvatarView.swift`.

## Run it against the hub

Start the hub on the Mac (`cd hub && npm run dev`, or however it is run for the demo); it listens on port 4310 and announces itself over Bonjour. Phone and Mac on the same Wi-Fi. On first launch the app finds the hub by itself; if it does not, type the Mac's address (for example `192.168.1.20`) in the first-run screen or in Settings. Every screen has a `#Preview` with sample data (`Preview/SampleData.swift`), so the UI can be worked on in Xcode's canvas without a hub.

Where the code is: `Model/` (the hub's types, the world the socket builds, the hub's rules ported from TypeScript, the HTTP routes, the on-disk copy), `Screens/` (one folder per tab, plus `Alerts` and `Onboarding`), `Components/` (badges, bars, chart, steps card, the hub's icons in `HubIcon.swift`, the hub dock's widget look in `WidgetCard.swift`), `Localizable.xcstrings` (English and Portuguese). The original parts (`HubFinder`, `HubSocket`, `HealthSync`, `ReadingQueue`, `AlarmNotifier`, `BackgroundKeepAlive`) work as before. `StatusStrip.swift` is no longer shown anywhere.

## Run it

1. Open `Astrum.xcodeproj` in Xcode.
2. Target Astrum, Signing & Capabilities: choose your team. Change the bundle id from `space.astrum.phone` if Xcode says it is taken.
3. Check that these capabilities show (they come from `Astrum.entitlements`; add them with "+ Capability" if not): HealthKit with Background Delivery ticked, Time Sensitive Notifications, Background Modes with Audio and "Uses Bluetooth LE accessories" ticked (the second is for room location, `RoomLocator.swift`).
4. Run on a real iPhone (HealthKit and Bonjour need one). Phone and hub on the same Wi-Fi, hub started.
5. On first launch allow local network and notifications, then follow the first-run screens: the hub, your crewmate, "Allow Health access".
6. Once a crewmate is chosen the app asks for Bluetooth: allow it. Settings then shows "Room location": "In Galley (Measured)" near the cabin board, otherwise "Board not seen". The phone tells the hub when the owner enters or leaves the board's room. It means near the board, not inside the room; the thresholds are untuned (see `chip/README.md`).

The silent-audio keep-alive is in `BackgroundKeepAlive.swift`; set `isEnabled` to false to switch it off. It is for this prototype only, installed from Xcode, never the App Store.

## If the project does not open

Make it by hand in a few minutes:

1. Xcode, File, New, Project, iOS App. Name `Astrum`, interface SwiftUI, language Swift, no tests, no storage. Save it in a temporary folder.
2. In the new project's navigator, delete its `Astrum` folder (Move to Trash). Drag this repo's `phone/Astrum/` folder in, choosing "Create folders" and leaving "Copy items" off, with the Astrum target ticked.
3. Target, General: minimum deployment iOS 18.0, iPhone only.
4. Target, Build Settings: `Info.plist File` = path to `phone/Astrum/Info.plist`, `Code Signing Entitlements` = path to `phone/Astrum.entitlements`. Select `Info.plist` in the navigator and untick the Astrum target in the File inspector, so it is not copied as a resource.
5. Target, Info: add "Privacy - Health Share Usage Description" and "Privacy - Health Update Usage Description" (any honest sentence; the app only reads).
6. Signing & Capabilities: your team, then add HealthKit (tick Background Delivery), Time Sensitive Notifications and Background Modes (tick Audio). Run on the phone.
