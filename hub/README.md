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

## Base-wide event: declared by a crewmate

The hub has no weather or radiation feed, so a dust storm, a solar particle
event, a loss of pressure or a fire is declared by a person (core/events.ts).
It is one level 3 alert for everyone at once (kind "reported", no reading),
with a message to Earth and the boards sounding until someone says "I've seen
it". It works in production too; never while a story plays. One active event
per kind; anyone ends it. Kinds: `dust_storm`, `solar_particle_event`,
`pressure_loss`, `fire`, `other`. A steps card comes only where one of the
medical lead's covers the kind: `smoke-toxic-air` for a fire,
`decompression-radiation` for a loss of pressure or a solar particle event.

```sh
# Declare a dust storm: who says so (a crew id), where to go (a room id, optional), their words (optional, 280 characters)
curl -X POST http://localhost:4310/api/events/declare -H 'content-type: application/json' -d '{"kind":"dust_storm","by":"reyes","shelter":"command","note":"Storm front over the ridge, all inside."}'
# The active events
curl http://localhost:4310/api/events
# End one, by the id the declare returned (works at either stage)
curl -X POST http://localhost:4310/api/events/end -H 'content-type: application/json' -d '{"id":"event|dust_storm|1763200000000","by":"reyes"}'
```

Declared ahead, it is first a warning: `expectedAt` (hub clock, ms, in the
future, at most 72 hours ahead) makes it a level 2 notice for everyone, to
acknowledge, never a question: no countdown, no card, no buzzer, no message to
Earth. At `expectedAt` the same alert becomes the level 3 above. `source` is
`crew` (default: someone on board) or `earth` (a forecast mission control
sent, entered by a crewmate). Pending and active events are kept in
`<database>.events.json`, so a restart keeps them; one whose time passed while
the hub was down is level 3 on start and still says when it was expected.

```sh
# A solar particle event forecast by Earth for 6 hours from now
curl -X POST http://localhost:4310/api/events/declare -H 'content-type: application/json' -d "{\"kind\":\"solar_particle_event\",\"by\":\"okafor\",\"source\":\"earth\",\"shelter\":\"command\",\"expectedAt\":$(( $(date +%s) * 1000 + 6 * 3600000 ))}"
# Move the time, or cancel it ("did not happen"), while it is still a warning
curl -X POST http://localhost:4310/api/events/update -H 'content-type: application/json' -d '{"id":"event|solar_particle_event|1763200000000","by":"okafor","expectedAt":1763225000000}'
curl -X POST http://localhost:4310/api/events/update -H 'content-type: application/json' -d '{"id":"event|solar_particle_event|1763200000000","by":"okafor","cancel":true}'
```

Nothing here detects an event: the hub has no weather or radiation sensor.
The path for automatic solar-event warnings later is a radiation monitor the
crew adds, with a limit the crew sets, raising the warning with source
`sensor`.
