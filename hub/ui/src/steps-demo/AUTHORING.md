# Authoring a move

A move is one gesture from the medical lead's list (`~/Desktop/NASA/steps-demo/videos-astrum.md`). It is drawn live with Astrum's crew figures and loops seamlessly. You write one file, `moves/V<nn>-<her-name>.ts` (for example `moves/V05-leave-the-room.ts`), that exports a `Move` whose `name` is her file name without `.mp4`. It registers itself (`moves/index.ts` uses `import.meta.glob('./V*.ts')`), so **never edit `moves/index.ts`** or any file that is not yours.

If you need something from the rig (a new helper, a fix), append a dated request to `RIG-REQUESTS.md` in this folder. That file is append-only. The rig's owner serves the requests and documents any additions here.

The interface you write against is `gesture.ts`. Import everything from there. It is kept backward compatible.

## The rule that comes first

Animate only what her one-line description says, plus what anatomy forces. Some details matter medically and she did not specify them: where pads go, hand position, depth, head tilt, which side, how a mask seals. Take those from a named public guideline, cited in the move's `source`, or leave them out and add a line to the move's `questions` and to `~/Desktop/NASA/steps-demo/QUESTIONS-FOR-MEDICAL-LEAD.md`. Keep each question short, concrete and translatable. One move fewer is better than a wrong gesture.

Every move has `reviewed: false` until she approves it. The viewer shows whether the move is reviewed by the medical lead under every move. Never draw text inside the animation.

## Coordinates and the figure

- Metres. +y is up. With gravity the floor is y = 0.
- A figure's **root** is its centre of mass. A standing figure's root is at y = 0.98 (`COM_HEIGHT`), with the feet at 0. Rotations happen about the root.
- At rest a figure faces **+z**. Its own **+x side is arm and leg index 1**, and its −x side is index 0. Its body frame has the origin at the root, +z ahead and +y towards the head.
- Bones are `PELVIS`, `CHEST`, `HEAD`, `UPPER(a)`, `FORE(a)`, `HAND(a)`, `THIGH(l)`, `SHIN(l)` and `FOOT(l)`.
- `restJoint(bone)` gives a joint's rest position, in avatar metres (feet at 0).
- `fig.restPoint(bone, x, y, z, out)` gives where a point given in rest coordinates (feet at 0, facing +z) is now. For example, `fig.restPoint(UPPER(1), 0.275, 1.33, 0, out)` is the outside of the right shoulder. Use it to put a hand on someone.
- Useful rest heights: the chest's front is at z = 0.095, the lower breastbone is at y = 1.28 (`STERNUM_Y`), the shoulders are at y = 1.395 with x = ±0.185, and the hips are at y = 0.93 with x = ±0.088.

## Tracks (`Moves`)

Each person is a `Moves` object. Every field is a track: keys of `[time, value, mode?]`.

| field | value | meaning |
|---|---|---|
| `root` | `[x, y, z]` | centre of mass, in the world |
| `turn` | `[yaw, pitch, roll]` | the body about its centre of mass; pitch > 0 leans forward |
| `chest` | `[pitch, yaw, roll]` | the chest on the hips; pitch > 0 bends forward |
| `head` | `[pitch, yaw, roll]` | the head on the chest; pitch > 0 nods down; yaw > 0 turns towards its +x side |
| `hands` | `[trackA0, trackA1]`, each `[x, y, z]` | wrist position in the body frame |
| `elbows` | `[x, y, z]` per arm | which way the elbow points, in the body frame |
| `feet` | `[x, y, z]` per leg | ankle position in the body frame |
| `knees` | `[x, y, z]` per leg | which way the knee points (default: forward) |
| `wrists` / `ankles` | `[pitch, yaw, roll]` | the hand on the forearm and the foot on the shin |
| `orient` | `THREE.Quaternion` | a fixed turn applied before `turn`; lying down, for example |
| `overlap` | number | how much the head and free hands lag behind changes of speed (0 to 1.5) |

Anything you leave out takes the neutral float: arms forward and knees up. Use `null` for one arm or leg to keep its neutral.

Keys are joined by smooth curves that carry through a key. There are three modes:

- `'still'` eases in and out, with zero speed at that key.
- `'lin'` keeps a constant speed. Use it for weightless glides: nothing changes speed without a push.
- `'auto'` (the default) is smooth.

For looping, use `cycle(keys, T)`: keys over one loop, and do not repeat the first key at the end. The loop closes on itself with continuous speed. Use `track(keys)` only with `loop: 'seam'`.

## Contacts: hands and feet that land and stay

Call these in `act`, after the tracks have run:

- `reach(fig, arm, point, fingers, into, weight)` puts the middle of the palm exactly on `point`. `fingers` is the direction the fingers point. `into` is the direction the palm presses. `weight` runs 0..1 and blends in from the track's free position, so ramp it with `ramp(t, a, b)` and the hand flies in rather than snapping.
- `plant(fig, leg, spot, toes, up, weight)` puts the sole flat on a surface with outward normal `up`, with the ankle over `spot`. Use it for feet on a floor, under a bar or against a wall. Pass `up = (0, -1, 0)` with a point on the floor to lay the top of the foot on the floor (kneeling).
- A point on another person comes from `other.restPoint(...)`. It follows them exactly. `gesture` solves everyone before `act` and again after it, so contacts on a moving body hold.
- `palmOf(fig, arm, out)` gives where the palm is now, for a contact ring.

If a target is out of reach, the hand stops short. The capture tool prints `contact misses` (worst miss in metres): it must be 0.

## Props

```ts
new Prop(world, (pen) => { pen.box(...); pen.circle(...); pen.seg(...); }, { strength, width, boxes })
```

This draws the prop in lines in its own frame. `boxes` are solid blocks in the background colour, so the prop hides what is behind it. Each frame in `act`, place it with one of these:

- `prop.at(x, y, z, yaw, pitch, roll)`
- `prop.follow(fig, HAND(1), [offset], quaternion)`, which carries it in the hand

Set `prop.shown = 0..1` to show it for only part of the loop. The pen has `seg`, `path`, `box`, `rectXY`, `rectXZ`, `rectYZ` and `circle(cx, cy, cz, r, 'xy'|'xz'|'yz')`.

## Marks

Ask for them with `marks: { contacts: n, arrows: m }`. Then in `act`, guard with `if (marks)` (it is null for the next round fading in over a seam):

- `marks.contacts[i].show(point, radius, amount, pulse)` draws a ring and glow on a point of contact.
- `marks.arrows[i].show(from, to, headLength, amount)` draws a thin arrow, which her spec allows.

## Gravity

`gravity: 'gravity'` draws a floor line at y = 0; people stand, kneel or lie on it. `'weightless'` has no floor, and the whole scene drifts slightly on a path that closes every loop.

A move with both variants gives two entries in `variants`. A move that has no variant for one of them leaves it out, and the viewer shows it as unavailable. Her list fixes some of these: V09 and V10 are with gravity only, and V12 and V13 are weightless only.

Weightless bodies never drop. They start moving only by pushing on something, glide at a constant speed (`'lin'`), and stop by catching something. Use the neutral posture with knees up and arms forward. With gravity, keep feet planted with `plant` while they bear weight. Move the root, not the feet, and the knees bend by themselves.

## The camera

```ts
camera: { target: [x, y, z], yaw, pitch, extent, span }
```

The camera looks at `target` from `yaw` (radians round from +z, so 0 is from the front and positive is from the +x side) and `pitch` (up). `extent` metres of height and `span` metres of width both fit the box, so the default square works and so does any other shape. Check it at 240 and 720 px.

Pick the angle that reads in silhouette. Bend joints across the view, not towards the camera, and don't let the two bodies overlap.

## Loop

`duration` is about 3 s (her spec). Then choose:

- `loop: 'cycle'` (the default): all tracks are built with `cycle()`, and the action returns to its start. This is truly seamless. Use it for repeating gestures: pressing, waving, fanning or squeezing.
- `loop: 'seam'`: the action does not return (someone sits down or walks out). The last 0.5 s dissolves into the next round, which is already moving. Hold a still pose at the start, or have the tracks moving at t < 0 (they run on at their end speed), so the fade-in matches.

## A complete example: V02 sit and stay still

`moves/V02-sit-and-stay-still.ts`:

```ts
import { THIGH, Prop, cycle, gesture, plant, ramp, reach, sample1, track } from '../gesture.ts';
import type { Figure, Moves } from '../gesture.ts';
import * as THREE from 'three';
import type { Move } from '../step.ts';

const T = 3.4;
const SEAT = 0.46;

const person: Moves = {
  // Down onto the seat: the root goes down and back; the body leans forward and comes upright.
  root: track([[0, [0, 0.98, 0.18], 'still'], [0.35, [0, 0.95, 0.17], 'still'], [0.85, [0, 0.82, 0.1]], [1.35, [0, 0.6, -0.02]], [1.6, [0, 0.585, -0.03], 'still'], [T, [0, 0.585, -0.03], 'still']]),
  turn: track([[0, [0, 0, 0], 'still'], [0.35, [0, 0.04, 0]], [0.95, [0, 0.42, 0]], [1.4, [0, 0.12, 0]], [1.75, [0, 0.03, 0], 'still'], [T, [0, 0.03, 0], 'still']]),
  chest: track([[0, [0, 0, 0]], [0.9, [0.12, 0, 0]], [1.6, [0.04, 0, 0]], [T, [0.04, 0, 0]]]),
  head: track([[0, [0.05, 0, 0]], [0.9, [-0.25, 0, 0]], [1.6, [0.08, 0, 0]], [T, [0.1, 0, 0]]]),
  hands: [track([[0, [-0.27, -0.42, 0.02]], [0.9, [-0.3, -0.2, 0.28]], [1.4, [-0.2, -0.3, 0.3]]]), track([[0, [0.27, -0.42, 0.02]], [0.9, [0.3, -0.2, 0.28]], [1.4, [0.2, -0.3, 0.3]]])],
  elbows: [track([[0, [-1, 0, -1]]]), track([[0, [1, 0, -1]]])],
  overlap: 0.6,
};
const breath = cycle([[0, 0], [0.85, 0.012], [1.7, 0], [2.55, 0.012]], T);
const into = new THREE.Vector3(0, -1, 0), fingers = new THREE.Vector3(), lap = new THREE.Vector3();
const toes = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), spot = new THREE.Vector3();

export const v02: Move = {
  id: 'V02',
  name: 'V02-sit-and-stay-still',              // her file name without .mp4: the library key
  summary: 'Sits down and stays still, hands on the lap.',
  params: {},
  medical: false,
  reviewed: false,
  questions: ['V02, no gravity: in orbit there is no sitting. Should the person hold still with the feet under a foot bar, or be strapped to a seat?'],
  variants: {
    gravity: (world) => gesture(world, {
      duration: T,
      loop: 'seam',                              // sitting down does not come back up
      gravity: 'gravity',
      cast: [{ moves: person }],                 // the first is the actor (full strength)
      props: (w) => [new Prop(w, (pen) => {      // a stool, in lines, solid
        pen.box(-0.2, SEAT - 0.04, -0.3, 0.2, SEAT, 0.08);
        for (const [x, z] of [[-0.17, -0.27], [0.17, -0.27], [-0.17, 0.05], [0.17, 0.05]]) pen.seg(x, 0, z, x, SEAT - 0.04, z);
      }, { strength: 0.55, boxes: [[-0.2, SEAT - 0.04, -0.3, 0.2, SEAT, 0.08]] })],
      act: (t, [f]: Figure[]) => {
        plant(f, 0, spot.set(-0.11, 0, 0.2), toes, up, 1);   // feet stay on the floor
        plant(f, 1, spot.set(0.11, 0, 0.2), toes, up, 1);
        const w = ramp(t, 1.35, 1.75);                        // hands onto the thighs once down
        for (let a = 0; a < 2; a++) {
          const s = a === 0 ? -1 : 1;
          f.restPoint(THIGH(a), s * 0.09, 0.72, 0.075, lap);
          fingers.set(0, -1, 0).applyQuaternion(f.q[THIGH(a)]);
          reach(f, a, lap, fingers, into, w);
        }
        f.root.y += sample1(breath, t) * ramp(t, 1.6, 2.0);  // breathing once still
      },
      camera: { target: [0, 0.9, 0.05], yaw: 0.85, pitch: 0.12, extent: 2.2, span: 1.7 },
      keys: [0.2, 1.0, 2.4],                     // poses for reduced motion
    }),
  },
};
```

There is nothing to register: the file name starts with `V`, so the library finds it. The key is `name`.

Allocate vectors outside `act`, at module level as above. `act` runs every frame and must not create objects.

## Checking your move

### 1. Typecheck

```sh
cd ~/Desktop/Astrum/hub && npx tsc --noEmit
```

It must print nothing for files in `ui/src/steps-demo/`.

### 2. Build privately and serve on your own port

The owner's dev server on 5173 also serves the page, but captures are steadier from a private build. Never write `hub/ui/dist`, and never use ports 4310, 5173 or 5174. Pick your own `<PORT>` (for example 4401, 4402 or 4403) and your own output folder. Use a fresh folder name each time you rebuild.

```sh
cd ~/Desktop/Astrum/hub
npx vite build --config ui/src/steps-demo/vite.demo.config.ts --outDir /tmp/astrum/steps-dist-<you>
cd /tmp/astrum/steps-dist-<you> && python3 -m http.server <PORT> --bind 127.0.0.1 &
# Note its PID and kill only that PID when done.
```

### 3. Look at frames, and run the contact check

```sh
cd ~/Desktop/Astrum/hub/ui/src/steps-demo
node capture.mjs --url "http://127.0.0.1:<PORT>/steps-demo.html?capture=1&move=<name>&gravity=<weightless|gravity>" \
  --out /tmp/astrum/<you>/<name>-frames --at 0,0.5,1,1.5,2,2.5,2.98 --w 720 --h 720 --dpr 1
```

Read the PNGs and check:

- the gesture reads in silhouette;
- nothing passes through a body or a prop;
- the frame at T − 1/60 leads into the frame at 0;
- it still reads at `--w 240 --h 240`.

Add `--permiss` to print every frame where a contact missed, with its time. With `--permiss` the misses are reset before each frame, so the closing `contact misses` line then covers only the last frame: the check is that no `miss at` line was printed. The script also prints `library {moves, broken}`: the moves that registered, and any `V*.ts` file that failed to load, with the error. A broken file is skipped and does not break the others, but it must be fixed.

The second-to-last line is the **contact check**, `contact misses {"worst": …}`. It is the furthest any hand or foot in contact fell short of its target over the frames captured. To check the whole loop, capture it with `--from 0 --to end --fps 20`. **It must be 0.** If it isn't, bring the body closer, or move the contact point.

### 4. The 720×720 loop and a still

```sh
D=/tmp/astrum/<you>/<name>-loop
node capture.mjs --url "http://127.0.0.1:<PORT>/steps-demo.html?capture=1&move=<name>&gravity=<g>" \
  --out $D --from 0 --to end --fps 60 --w 720 --h 720 --dpr 2
/opt/homebrew/bin/ffmpeg -y -framerate 60 -i $D/f%05d.png -vf "scale=720:720:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset slow -crf 17 -movflags +faststart ~/Desktop/NASA/steps-demo/loops/<name>.mp4
/opt/homebrew/bin/ffmpeg -y -i $D/f00090.png -vf "scale=720:720:flags=lanczos" ~/Desktop/NASA/steps-demo/loops/<name>.png
```

`--to end` captures exactly one loop, so the mp4 loops without a seam. For a move with both gravities, name the files `<name>-with-gravity.mp4` and `<name>-no-gravity.mp4` (and the stills the same way); a move with one variant keeps her file name as it is.

## Notes

- `&cam=yaw,pitch[,extent[,x,y,z]]` (viewer and capture) looks at a `gesture()` move from another angle, closer, or at another target, without editing the move: for checking a contact from the side, or that a hand is not through a body. Example: `&cam=2.45,0.6,0.8,0,0.15,0` looks closely at a lying person's chest. Never use it for a loop that ships.
- The private build can also be served with `python3 -m http.server`; a Vite dev server reloads the page whenever any move file is saved, which spoils a long capture while other authors are working, so capture loops from a build.

- `?capture=1&move=<name>` captures without any text: no name labels and no not-reviewed note, by her rule of no text inside the animation. Add `&labels=1` to keep them.
- `&gravity=weightless|gravity` picks the variant. Without it, the first variant the move defines is used.
- The viewer and capture wait for `movesReady` (from `moves/index.ts`) before reading `MOVES`. Code that reads the library must do the same.
- A file named `V…ts` that exports no `Move` (a helper module, for example) is fine. It is loaded and ignored.

## Questions for the medical lead

The file is `~/Desktop/NASA/steps-demo/QUESTIONS-FOR-MEDICAL-LEAD.md`. It is shared and append-only:

- Re-read it right before you append, and never rewrite or reorder it.
- Write one line per question, starting with the move's ID: `- V06: which side do they turn onto, left or right?`
- Keep each question short, concrete and translatable.
- Put the same questions in the move's `questions` array.
