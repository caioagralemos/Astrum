# Phone

The iPhone app for one crewmate. It shows that person's body and readings, sends Apple Watch Health readings to the hub, and turns alerts into notifications.

## Run it

1. Open `Astrum.xcodeproj` in Xcode.
2. Target Astrum, Signing & Capabilities: pick your team. Change the bundle id (`com.caioagralemos.astrum`) if Xcode says it is taken.
3. Start the hub: open the Astrum app (Mac or Windows, from the [latest release](https://github.com/caioagralemos/Astrum/releases/latest)), or from source `cd hub && npm run core`.
4. Run on a real iPhone on the same Wi-Fi as the hub. Health and Bonjour need a real phone.
5. Allow local network, notifications, Health, Bluetooth and camera when asked.
6. The app finds the hub by itself. If not, type the hub computer's address.

Without a hub: every screen has a `#Preview` with sample data (`Preview/SampleData.swift`).

## Folders

- `Astrum/Model/`: the hub's types, socket, routes, rules
- `Astrum/Screens/`: one folder per tab, plus `Alerts`, `Onboarding`, `CheckIn`
- `Astrum/Components/`: badges, bars, charts, icons
- `Astrum/Resources/`: the offline body avatar (`avatar.html`)
- `Astrum/Localizable.xcstrings`: English and Portuguese
- `Checks/`: checks for the app's logic
- `SKETCH-NOTES.md`: design notes

## What is real and what is simulated

- The blood-panel reader reads a screen with the camera. It is not a connection to the analyser.
- Every value read from a photo must be checked by the person before it is saved.
- Readings labelled Simulated or Replayed come from the hub's demo mode or a recording.

## The body avatar

After changing the avatar in the hub, rebuild its offline copy: `cd hub && node scripts/build-phone-avatar.mjs`
