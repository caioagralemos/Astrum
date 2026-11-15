# Hub

The desktop app that runs on the station computer.

## Drill: test the real alert flow on a phone

A recorded story ("Reyes's night") is a recording: its alerts cannot be
answered. A drill is the real alert engine on the live hub, on a simulated
CO2 reading (4 mmHg, labelled simulated, never stored) in one person's room
(core/drill.ts). Demo mode only, one at a time, never while a story plays or
a real alarm is active. It ends by itself after 10 minutes.

```sh
# Start one for Reyes, in the room the hub has her in (or add "room":"quarters-2")
curl -X POST http://localhost:4310/api/drill/start -H 'content-type: application/json' -d '{"person":"reyes"}'
# What is running, and how the last one ended
curl http://localhost:4310/api/drill
# End it now: its alarm and alerts end, the message to Earth stays listed as a resolved drill
curl -X POST http://localhost:4310/api/drill/stop
```

Her phone gets the level 2 "Are you OK?" with the real 60-second countdown.
"I am OK" records the answer: the alert stays at level 2, answered, for as
long as the room stays over the limit (here, until the drill ends); nothing
escalates and nothing goes to Earth. The room's board, if it has one, sounds
until the room alarm is acknowledged. "I need help", or no answer within 60
seconds, is level 3 for everyone, with the steps card, a message to Earth and
the boards sounding until someone says "I've seen it".
