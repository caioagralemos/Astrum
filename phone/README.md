# Phone

The iPhone app. Native, but thin: it finds the hub on the Wi-Fi (Bonjour, or a typed address), sends the Apple Watch's Health readings to it, keeps a live socket open and turns room alarms into notifications (which a locked phone passes to the Watch). Everything else on screen is the hub's own interface in a web view.

## Run it

1. Open `Astrum.xcodeproj` in Xcode.
2. Target Astrum, Signing & Capabilities: choose your team. Change the bundle id from `space.astrum.phone` if Xcode says it is taken.
3. Check that these capabilities show (they come from `Astrum.entitlements`; add them with "+ Capability" if not): HealthKit with Background Delivery ticked, Time Sensitive Notifications, Background Modes with Audio ticked.
4. Run on a real iPhone (HealthKit and Bonjour need one). Phone and hub on the same Wi-Fi, hub started.
5. On first launch allow local network and notifications, pick the hub and your crewmate in Settings, then tap "Allow Health access".

The silent-audio keep-alive is in `BackgroundKeepAlive.swift`; set `isEnabled` to false to switch it off. It is for this prototype only, installed from Xcode, never the App Store.

## If the project does not open

Make it by hand in a few minutes:

1. Xcode, File, New, Project, iOS App. Name `Astrum`, interface SwiftUI, language Swift, no tests, no storage. Save it in a temporary folder.
2. In the new project's navigator, delete its `Astrum` folder (Move to Trash). Drag this repo's `phone/Astrum/` folder in, choosing "Create folders" and leaving "Copy items" off, with the Astrum target ticked.
3. Target, General: minimum deployment iOS 18.0, iPhone only.
4. Target, Build Settings: `Info.plist File` = path to `phone/Astrum/Info.plist`, `Code Signing Entitlements` = path to `phone/Astrum.entitlements`. Select `Info.plist` in the navigator and untick the Astrum target in the File inspector, so it is not copied as a resource.
5. Target, Info: add "Privacy - Health Share Usage Description" and "Privacy - Health Update Usage Description" (any honest sentence; the app only reads).
6. Signing & Capabilities: your team, then add HealthKit (tick Background Delivery), Time Sensitive Notifications and Background Modes (tick Audio). Run on the phone.
