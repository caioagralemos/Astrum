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

**Ask Astra.** One field, three example questions, progress while the hub works, then the answer tagged with who wrote it (Astra, the hub from your readings, a fixed text), the hub's facts each with its label, and NASA's words quoted with source and link. The model runs on the hub. Out of reach, the tab says so and asking is off. *Code:* `Screens/Ask/`.

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
