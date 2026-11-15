// The product page. Every word lives in COPY below so it can be rewritten in
// one place; every <Slot> is media that doesn't exist yet.
//
// Words wrapped in draft() are new and not yet the owner's: each renders with
// data-draft="true" on its element, so `document.querySelectorAll('[data-draft]')`
// lists everything still to rewrite. Blocks marked data-in-progress="true"
// describe work that may not land; delete them if it doesn't.

import { useState } from 'react';

const REPO = 'https://github.com/caioagralemos/Astrum';
// The hub's own interface, built into public/demo/ by `npm run demo`, playing
// the recorded story from static files. A plain link, not an iframe: the demo
// is a full 3D interface with its own controls, and on a phone an embedded
// frame would fight the page for scrolling and touch.
const DEMO = './demo/index.html?replay=scenario/reyes-night.json';

/** A line of copy: the owner's own (a string) or a new draft. */
type Line = string | { draft: string };
const draft = (s: string): Line => ({ draft: s });
const text = (l: Line) => (typeof l === 'string' ? l : l.draft);
const mark = (...lines: Line[]) => (lines.some((l) => typeof l !== 'string') ? { 'data-draft': 'true' } : {});

type Media =
  | { slot: string }
  | { src: string; alt: string; caption: Line; width: number; height: number };

interface Pillar {
  id: string;
  title: Line;
  body: Line;
  more: Line[];
  check: Line;
  links: [Line, string][];
  media: Media;
  folder: string;
}

const COPY = {
  premise: draft('A health system that reads each crewmate’s body and the room they are in, on one timeline.'),
  lead: draft('When someone feels unwell, its evidence card says whether the cause points to the room, the person or a sensor.'),
  what: 'Astrum is a health system for crews on long missions. It runs on the station itself, with no help from Earth.',
  count: 'Replays 12,087 real ISS cabin readings from NASA’s OSDR.',
  heroShot: {
    caption: draft('Simulated scenario. The hub’s own interface during Reyes’s night: her quarters are over NASA’s CO2 limit, and she is asked if she is OK.'),
    alt: 'The Astrum hub: a cutaway 3D station in Mars orbit with the crew in their rooms. Quarters 2 is marked over the limit, and an alert reads: Reyes is in Quarters 2, where CO2 is over NASA’s limit. Are you OK? 9 seconds to answer.',
  },
  clipCaption: draft('The real board, phone and hub.'),

  demo: {
    title: draft('The demo, one tap away'),
    body: draft('Reyes’s night, recorded from the hub and played in the hub’s own interface, in your browser. Nothing to install and no server. It runs about two minutes, with Replay and Skip at the bottom of the screen.'),
    label: 'Simulated scenario',
    steps: [
      draft('Night on a station in Mars orbit. Reyes is asleep in Quarters 2. No alarm.'),
      draft('The air in her quarters stops moving, and the room plays the climb in NASA’s ISS record.'),
      draft('The room’s 1-hour CO2 average passes NASA’s 3 mmHg limit. Reyes is asked “Are you OK?” and the Crew Medical Officer is told.'),
      draft('No answer in 60 seconds: everyone is told, the alert names the high-CO2 steps card, and a message goes to Earth with the delay counted.'),
      draft('Okafor, the Crew Medical Officer, reaches her and takes her to the galley. The alerts end; the message to Earth stays listed until its reply can arrive.'),
    ],
    note: draft('The rooms’ CO2, temperature and humidity are NASA’s ISS record, replayed unchanged. The crew, their bodies and where they are are simulated.'),
  },

  problem: {
    title: 'From Mars, a message to Earth takes up to 22 minutes. The reply takes just as long.',
    body: 'Astronauts aren’t doctors. They have a crewmate with basic medical training, checklists, and flight surgeons on the ground. On a long mission the ground is too far away to help in the moment, so the help has to be on board.',
  },

  how: {
    title: 'How it works',
    body: draft('On three mornings in a row Reyes reports a headache. The CO2 in her quarters is below NASA’s limit, so no alarm sounds. The hub lines up her own normal, the rooms she has been in and her crewmates, and its evidence card points to her room. Tonight the air in her quarters stops moving and the CO2 climbs past the limit: she is asked if she is OK, the Crew Medical Officer is told, and when she doesn’t answer, everyone is.'),
  },

  pillars: [
    {
      id: 'phone',
      title: 'The phone and Watch',
      body: draft('Each crewmate wears an Apple Watch. Their iPhone reads heart rate, sleep and activity from it, sends them to the hub, and buzzes them when the hub raises an alert, even with the phone locked.'),
      more: [
        draft('There is no Watch app. The Watch is worn and read through the phone, and shows the phone’s alerts.'),
        draft('The app is a native SwiftUI app: it finds the hub on the local Wi-Fi, sends the readings, and shows its owner’s own body, check-ins, questions to the model and the station, and its blood-panel reader reads the analyser’s screen with the camera; it is not a connection to the device.'),
      ],
      check: draft('Check: HealthSync.swift lists the ten Health readings it sends; AlarmNotifier.swift turns the hub’s alerts into time-sensitive notifications.'),
      links: [],
      media: { slot: 'Screenshot from Caio’s phone, with the body figure' },
      folder: 'phone',
    },
    {
      id: 'chip',
      title: 'The cabin chip',
      body: 'A small board in the room measures temperature, humidity, pressure, light, noise and vibration, and sends every reading to the hub.',
      more: [
        draft('It is a real ESP32 board, connected to the hub by USB. Its buzzer is the room alarm.'),
        draft('CO2, oxygen and radiation are empty slots. This board has no working part for them, so it lists them as missing in every line it sends. It never makes a value up.'),
      ],
      check: draft('Check: the wiring blueprint, four sheets: the board as built, the schematic, the pin table, and the slots with no part.'),
      links: [[draft('Wiring blueprint (PDF)'), `${REPO}/blob/main/chip/wiring-blueprint.pdf`]],
      media: { slot: 'Photo of the real board' },
      folder: 'chip',
    },
    {
      id: 'hub',
      title: 'The hub',
      body: 'An app on the station’s computer. It keeps everyone’s readings and compares each person with their own normal, the rooms they’ve been in and the rest of the crew. When something is wrong, it shows what it found and the steps to take.',
      more: [
        draft('One timeline holds every reading, from bodies, rooms and the crew, so anything lines up with anything by time, person and room.'),
        draft('NASA’s limit: a room alarm when a room’s 1-hour CO2 average passes 3 mmHg. CO2 is the only alarm, because it is the only limit verified in NASA’s text so far.'),
        draft('Three alert levels. Level 1 tells only the person, never while they sleep. Level 2 asks “Are you OK?” and tells the Crew Medical Officer. Level 3, after 60 seconds with no answer or on “I need help”, tells everyone, names the steps card and messages Earth.'),
        draft('The evidence card asks four questions: is this unusual for the person, is anyone else in the same room affected, where have they been, and what did they report. Then it says where it points: the room, the person, or the sensor.'),
        draft('A small language model runs on the same computer, with no connection. It explains NASA’s text and the readings, and its words are shown only when they pass every check.'),
      ],
      check: draft('Check: the rules are plain code with tests in hub/engine: alerts.ts, cabin.ts, evidence.ts.'),
      links: [],
      media: {
        src: './shots/demo-level-3.jpg',
        width: 1440,
        height: 900,
        alt: 'The Astrum hub at alert level 3: Reyes is in Quarters 2, where CO2 is over NASA’s limit. Told: everyone. Steps card: high-co2. Message to Earth sent; a reply can arrive in 38 minutes.',
        caption: draft('Simulated scenario. Level 3: everyone is told, the steps card is named, and a message to Earth is sent with the reply time counted.'),
      },
      folder: 'hub',
    },
  ] satisfies Pillar[],

  sources: {
    title: 'The NASA data behind it',
    body: draft('NASA’s data is what the hub computes with. For each source: what it is, how the hub uses it, and any caveat.'),
    rows: [
      [
        draft('NASA OSDR, Environmental Data Application'),
        draft('ISS cabin telemetry recorded during Rodent Research-1 (SpaceX-4), 20 Sep to 1 Nov 2014: 12,087 readings each of CO2, temperature and humidity, one every 5 minutes.'),
        draft('Replayed unchanged, shifted in time, as the air of the station’s rooms. The hub computes each room’s 1-hour CO2 average and each person’s hours above 2.8 mmHg from it.'),
        draft('NASA does not state the CO2 unit. Astrum reads it as ppm and converts it at a cabin pressure of 760 mmHg. Where on the station the sensor was is not stated.'),
      ],
      [
        draft('NASA-STD-3001 CO2 Technical Brief (OCHMO-TB-004)'),
        draft('NASA’s CO2 limit for crews, and what crews report below it.'),
        draft('The room alarm’s limit, a 1-hour average of “no more than 3 mmHg”, and the band where NASA reports “Headaches at levels between 2.8-4.5 mmHg”, used to count each person’s exposure.'),
        draft('None.'),
      ],
      [
        draft('NASA passage library'),
        draft('90 passages from 26 NASA pages: the 24 hazard and risk pages linked from the challenge, and NASA-STD-3001 briefs on CO2 and bone loss. Quoted unchanged.'),
        draft('The text the hub quotes word for word beside an answer, and the only NASA text the model is given.'),
        draft('Picking the right passage is a search, and it misses some questions (see the safety results).'),
      ],
      [
        draft('NASA Life Sciences Portal: STS-40 and STS-58'),
        draft('Resting heart rate and blood pressure of astronauts, measured in flight (Shykoff, Farhi et al., 1996).'),
        draft('Each simulated crewmate’s usual heart rate and blood pressure is one astronaut’s in-flight row.'),
        draft('The movement around these values is invented, and every row it makes is labelled Simulated.'),
      ],
      [
        draft('NASA Life Sciences Portal: sleep on Mir'),
        draft('Sleep recorded on 109 in-flight nights on Mir: 307 minutes, 65.8 % efficiency, 6.5 awakenings a night.'),
        draft('The centre of the simulated crew’s sleep.'),
        draft('Same as above.'),
      ],
      [
        draft('NASA Life Sciences Portal: STS-89 mood'),
        draft('Mood ratings of the STS-89 crew in flight: stress, fatigue and sleepiness.'),
        draft('The centre of the simulated crew’s morning mood.'),
        draft('Group means, not individuals.'),
      ],
      [
        draft('NASA Human Research Program'),
        draft('Exercise on the ISS: “1.5 hours per day”, resistance and aerobic together.'),
        draft('The exercise each crewmate’s minutes are compared with.'),
        draft('None.'),
      ],
      [
        draft('NASA OSDR: Inspiration4 blood panels (OSD-569, OSD-575)'),
        draft('Complete blood count and metabolic panel of the four Inspiration4 private astronauts, 2021, with the lab’s own ranges.'),
        draft('In demo mode, one subject’s values play as one simulated crewmate’s blood results, labelled Replayed, each naming the subject and the day.'),
        draft('Taken before and after flight only, none in flight. Hemoglobin’s unit in the file does not match its values, so it is left out.'),
      ],
      [
        draft('NASA Life Sciences Portal: radiation on Mir'),
        draft('Radiation dose rates measured in six places on Mir, 1995 (Badhwar et al.).'),
        draft('The centres of the demo’s per-room radiation readings.'),
        draft('Mir flew inside Earth’s magnetic field. The values shown are simulated.'),
      ],
    ] satisfies Line[][],
  },

  real: {
    title: 'What’s real and what’s simulated',
    body: 'The demo tells a made-up story, and the screen says so the whole time.',
    bodyMore: draft('The NASA data in it is real. The hardware is real too, and runs outside the demo.'),
    rows: [
      ['Cabin chip sensors', 'real', 'Measured live on the board'],
      [draft('Phone and Watch'), 'real', draft('The iPhone app reads its owner’s own Watch through Health and sends those readings to the hub')],
      [draft('NASA’s records and text'), 'real', draft('Quoted and replayed unchanged, each with its source')],
      ['ISS cabin CO2', 'replayed', 'NASA’s recorded readings, replayed'],
      [draft('The rules'), 'real', draft('Limits, alert levels and the evidence card, as plain code with tests')],
      [draft('The local model'), 'real', draft('Runs on the hub’s computer with no connection. It is not part of the web demo')],
      ['The crew', 'sim', 'Built from published astronaut numbers, each one cited'],
      ['Which room each person is in', 'sim', 'Set by the story'],
      [draft('The scenario'), 'sim', draft('Written for the demo. The screen says “Simulated scenario” throughout')],
    ] satisfies [Line, 'real' | 'replayed' | 'sim', Line][],
    labelsTitle: draft('The five labels'),
    labelsBody: draft('The interface puts one of these on every reading.'),
    labels: [
      ['Measured', draft('A sensor read it, here and now.')],
      ['Estimated', draft('Worked out from something measured.')],
      ['Reported', draft('Said by the person, like a check-in answer.')],
      ['Replayed', draft('A real measurement from somewhere else, NASA’s ISS record, played back here.')],
      ['Simulated', draft('Made up for the demo.')],
    ] satisfies [string, Line][],
    labelsNote: draft('Outside demo mode the hub keeps only the first three.'),
  },

  safety: {
    title: 'What it won’t do',
    cards: [
      ['It doesn’t diagnose.', 'It points at what changed. Deciding is up to the crew and their flight surgeon.'],
      ['The AI doesn’t write emergency steps.', draft('Steps come only from cards our medical lead has approved, picked by rules, never by the model. The cards’ text was drafted with an AI tool and reviewed and approved line by line by our medical lead; most steps are not yet checked against a source.')],
      [draft('The AI only answers from NASA’s text and the readings.'), 'If NASA’s pages don’t cover a question, it says it doesn’t know.'],
    ] satisfies [Line, Line][],
    note: draft('Built during NASA Space Apps 2026. Astrum is not a medical device.'),
    howTitle: draft('How an answer is built'),
    how: [
      draft('The hub writes the facts: sentences built by code from the readings and the evidence card, each with its label, and NASA’s passage quoted word for word.'),
      draft('The model’s own words are shown only when they pass every check: no orders or advice, no medicine or dose, no diagnosis. Otherwise the crew sees the hub’s sentences and NASA’s quote.'),
      draft('A steps card is picked by rules: the limit that is broken, the check-in answers given, the words the crewmate typed. The hub shows only cards marked approved.'),
      draft('A question that names a medicine or a dose gets a fixed answer from the hub, and never reaches the model. A crisis phrase the hub recognises goes to a person, and the words are not repeated.'),
      draft('On the demo story’s questions, the checks currently discard everything the model writes, so the crew sees the hub’s sentences and NASA’s quote.'),
    ],
    resultsTitle: draft('Measured, 15 Nov 2026'),
    resultsBody: draft('The local model, temperature 0, one run per case. The weak results are listed with the strong ones.'),
    results: [
      [draft('Unsafe answers shown to the crew, all 96 single questions to the model'), draft('0')],
      [draft('Routing: steps card, fixed answer or model, as expected'), draft('31 of 31')],
      [draft('Explaining, with hand-picked NASA passages'), draft('20 passed, 5 failed, 2 discarded by the checks (of 27)')],
      [draft('Explaining, with the hub’s own search'), draft('25 passed, 0 failed, 2 discarded by the checks (of 27)')],
      [draft('Questions about the demo story'), draft('6 passed, 4 discarded (of 10). The model’s own words were shown in none (eval of 14 Nov; not in the 15 Nov run)')],
      [draft('Crisis phrases, word list, no model'), draft('3 of 10 crisis phrases caught; 4 of 4 ordinary phrases left alone. The weakest piece')],
      [draft('The medical lead’s 96 test cases, run on the hub’s rules, no model'), draft('79 passed, 17 failed')],
      [draft('Search, questions it was never tuned on'), draft('Right passage in the top 3 for 17 of 20')],
      [draft('Search, full sentences written after the last fix'), draft('5 of 8')],
    ] satisfies [Line, Line][],
    resultsNote: draft('“Failed” means what the crew saw missed a point the case required; unsafe answers are counted on their own. A crisis phrase the list misses reaches the model as an ordinary question, where every check still applies. Sources: hub/ai-eval/results (the eval of 15 Nov, 08:29 UTC), hub/medical/CASES-RESULTS.md and hub/engine/search.test.ts.'),
  },

  missions: {
    title: draft('Set up for another mission'),
    body: draft('A place is a mission file. The default, hub/profiles/missions/ship-mars-orbit.json, is a station in Mars orbit: the place, the mission’s start date, the delay to Earth (20 minutes each way), its eight rooms, its four crew and their roles, and which chip sits in which room. Another mission is another file, chosen on screen in Settings.'),
    // Delete this block if the other places don't land before submission.
    inProgress: draft('Four mission files exist, each with its rooms, crew and 3D layout: the station in Mars orbit, the ISS, a base on Mars and a base on the Moon. The crew can also make their own.'),
  },

  team: {
    title: 'Team',
    people: [
      ['Caio Agra Lemos', 'Design and engineering'],
      ['Leticia Alves Barbosa Leite', 'Medical lead: emergency cards, test cases and blood values'],
    ],
  },

  credits: {
    title: draft('Credits and resources'),
    groups: [
      {
        title: draft('NASA data and text'),
        items: [
          [draft('NASA OSDR, ISS cabin record (Rodent Research-1)'), 'https://visualization.osdr.nasa.gov/eda/api/missions/RR-1/co2/'],
          [draft('NASA OSDR, Inspiration4 blood count (OSD-569)'), 'https://osdr.nasa.gov/osdr/data/osd/files/569'],
          [draft('NASA OSDR, Inspiration4 metabolic panel (OSD-575)'), 'https://osdr.nasa.gov/osdr/data/osd/files/575'],
          [draft('NASA-STD-3001 CO2 Technical Brief (OCHMO-TB-004)'), 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-004-carbon-dioxide.pdf'],
          [draft('NASA-STD-3001 Bone Loss Technical Brief'), 'https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-030-bone-loss.pdf'],
          [draft('NASA Human Research Program: 5 Hazards of Human Spaceflight'), 'https://www.nasa.gov/hrp/hazards/'],
          [draft('NASA Human Research Program: Risks of Human Spaceflight'), 'https://www.nasa.gov/hrp/risks/'],
          [draft('NASA Life Sciences Portal (STS-40, Mir sleep, STS-89 mood, Mir radiation)'), 'https://nlsp.nasa.gov/'],
        ],
      },
      {
        title: draft('Software'),
        items: [
          [draft('React'), 'https://react.dev/'],
          [draft('Vite'), 'https://vite.dev/'],
          [draft('three.js'), 'https://threejs.org/'],
          [draft('Tauri'), 'https://tauri.app/'],
          [draft('llama.cpp'), 'https://github.com/ggml-org/llama.cpp'],
          [draft('LFM3 1.7B, the local language model (LFM Open License v1.0)'), ''],
          [draft('Node.js, serialport, ws, bonjour-service'), 'https://nodejs.org/'],
          [draft('Arduino core for the ESP32'), 'https://github.com/espressif/arduino-esp32'],
        ],
      },
    ] satisfies { title: Line; items: [Line, string][] }[],
  },

  ai: {
    title: 'AI use',
    lines: [
      draft('[Describe here where AI tools were used to make this project, as the Space Apps rules require.]'),
      draft('Tool: [tool name].'),
      draft('Code: [which parts were written or edited with it, and how they were reviewed].'),
      draft('Text: [which text, including this page, was drafted with it].'),
      draft('Images and video: the screenshots on this page are of the real interface. [Any AI-generated image or video carries a visible watermark.]'),
    ],
  },
};

// A short muted clip of the real hardware, if one has been added. Vite finds
// the file at build time, so with no file nothing renders and nothing shifts.
const clips = import.meta.glob('./media/hardware.mp4', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const CLIP: string | undefined = clips['./media/hardware.mp4'];
const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function HeroClip() {
  const [failed, setFailed] = useState(false);
  if (!CLIP || failed) return null;
  return (
    <figure className="shot clip">
      <video
        src={CLIP}
        width={1280}
        height={720}
        muted
        loop
        playsInline
        autoPlay={!reduceMotion}
        controls={reduceMotion}
        preload="metadata"
        aria-label="The real board, phone and hub"
        onError={() => setFailed(true)}
      />
      <figcaption {...mark(COPY.clipCaption)}>{text(COPY.clipCaption)}</figcaption>
    </figure>
  );
}

function Slot({ label, tall }: { label: string; tall?: boolean }) {
  return <div className={tall ? 'slot tall' : 'slot'} role="img" aria-label={`Placeholder: ${label}`}>{label}</div>;
}

function Header({ title, id, body }: { title: Line; id: string; body?: Line }) {
  return (
    <header>
      <h2 id={id} {...mark(title)}>{text(title)}</h2>
      {body && <p className="muted" {...mark(body)}>{text(body)}</p>}
    </header>
  );
}

function Tag({ kind }: { kind: 'real' | 'replayed' | 'sim' }) {
  return <span className={`tag ${kind}`}>{kind === 'real' ? 'Real' : kind === 'replayed' ? 'Replayed' : 'Simulated'}</span>;
}

export function App() {
  const { demo, problem, how, pillars, sources, real, safety, missions, team, credits, ai } = COPY;

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>

      <nav className="nav" aria-label="Main">
        <div className="wrap">
          <a className="mark" href="#top">Astrum</a>
          <ul>
            <li><a href="#how">How it works</a></li>
            <li><a href="#data">NASA data</a></li>
            <li><a href="#real">What’s real</a></li>
            <li><a href="#safety">Safety</a></li>
          </ul>
          <a className="button" href={DEMO}>Run the demo</a>
        </div>
      </nav>

      <main id="main">
        <div className="hero wrap" id="top">
          <img className="logo" src="./brand/logo.svg" alt="Astrum" width={505} height={104} />
          <h1 {...mark(COPY.premise)}>{text(COPY.premise)}</h1>
          <p className="lead" {...mark(COPY.lead)}>{text(COPY.lead)}</p>
          <p className="lead">{COPY.what}</p>
          <div className="actions">
            <a className="button" href={DEMO}>Run the demo</a>
            <a className="button ghost" href={REPO}>Source on GitHub</a>
          </div>
          <p className="count">{COPY.count}</p>
          <div className={CLIP ? 'hero-media' : 'hero-media solo'}>
            <figure className="shot">
              <a href={DEMO} aria-label="Run the demo">
                <img src="./shots/demo-level-2.jpg" width={1440} height={900} alt={COPY.heroShot.alt} fetchPriority="high" decoding="async" />
              </a>
              <figcaption {...mark(COPY.heroShot.caption)}>{text(COPY.heroShot.caption)}</figcaption>
            </figure>
            <HeroClip />
          </div>
        </div>

        <section aria-labelledby="demo-title" id="demo">
          <div className="wrap">
            <Header title={demo.title} id="demo-title" body={demo.body} />
            <div className="demo">
              <p><span className="tag sim">{demo.label}</span></p>
              <ol className="list">
                {demo.steps.map((step) => <li key={text(step)} {...mark(step)}>{text(step)}</li>)}
              </ol>
              <p className="muted" {...mark(demo.note)}>{text(demo.note)}</p>
              <div className="actions">
                <a className="button" href={DEMO}>Run the demo</a>
              </div>
            </div>
          </div>
        </section>

        <section className="problem" aria-labelledby="problem-title">
          <div className="wrap">
            <Header title={problem.title} id="problem-title" body={problem.body} />
          </div>
        </section>

        <section aria-labelledby="how-title" id="how">
          <div className="wrap">
            <Header title={how.title} id="how-title" body={how.body} />
            <div className="pillars">
              {pillars.map((p: Pillar) => (
                <article className="pillar" key={p.id} aria-labelledby={`${p.id}-title`}>
                  {'slot' in p.media ? (
                    <Slot label={p.media.slot} />
                  ) : (
                    <figure className="shot">
                      <img src={p.media.src} width={p.media.width} height={p.media.height} alt={p.media.alt} loading="lazy" decoding="async" />
                      <figcaption {...mark(p.media.caption)}>{text(p.media.caption)}</figcaption>
                    </figure>
                  )}
                  <div className="copy">
                    <h3 id={`${p.id}-title`} {...mark(p.title)}>{text(p.title)}</h3>
                    <p className="muted" {...mark(p.body)}>{text(p.body)}</p>
                    {p.more.length > 0 && (
                      <ul className="list muted">
                        {p.more.map((m) => <li key={text(m)} {...mark(m)}>{text(m)}</li>)}
                      </ul>
                    )}
                    <p className="check" {...mark(p.check)}>{text(p.check)}</p>
                    <p className="links">
                      <a href={`${REPO}/tree/main/${p.folder}`}>See the code</a>
                      {p.links.map(([label, href]) => <a key={href} href={href} {...mark(label)}>{text(label)}</a>)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="data-title" id="data">
          <div className="wrap">
            <Header title={sources.title} id="data-title" body={sources.body} />
            <div className="table-wrap">
              <table className="stack" aria-labelledby="data-title">
                <thead><tr><th scope="col">Source</th><th scope="col">What it is</th><th scope="col">How Astrum uses it</th><th scope="col" data-draft="true">Caveat</th></tr></thead>
                <tbody>
                  {sources.rows.map((cells) => (
                    <tr key={text(cells[0])} {...mark(...cells)}>
                      {cells.map((cell, i) => <td key={i} data-label={['Source', 'What it is', 'How Astrum uses it', 'Caveat'][i]}>{text(cell)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="real-title" id="real">
          <div className="wrap">
            <header>
              <h2 id="real-title">{real.title}</h2>
              <p className="muted">{real.body} <span {...mark(real.bodyMore)}>{text(real.bodyMore)}</span></p>
            </header>
            <div className="table-wrap">
              <table className="stack" aria-labelledby="real-title">
                <thead><tr><th scope="col">Part</th><th scope="col">Status</th><th scope="col">How</th></tr></thead>
                <tbody>
                  {real.rows.map(([part, kind, detail]) => (
                    <tr key={text(part)} {...mark(part, detail)}>
                      <td data-label="Part">{text(part)}</td>
                      <td data-label="Status"><Tag kind={kind} /></td>
                      <td data-label="How">{text(detail)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="sub">
              <h3 {...mark(real.labelsTitle)}>{text(real.labelsTitle)}</h3>
              <p className="muted" {...mark(real.labelsBody)}>{text(real.labelsBody)}</p>
              <dl className="labels">
                {real.labels.map(([name, meaning]) => (
                  <div key={name} {...mark(meaning)}>
                    <dt><span className="tag">{name}</span></dt>
                    <dd className="muted">{text(meaning)}</dd>
                  </div>
                ))}
              </dl>
              <p className="muted" {...mark(real.labelsNote)}>{text(real.labelsNote)}</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="safety-title" id="safety">
          <div className="wrap">
            <Header title={safety.title} id="safety-title" />
            <div className="grid-3">
              {safety.cards.map(([title, body]) => (
                <div className="card" key={text(title)}>
                  <h3 {...mark(title)}>{text(title)}</h3>
                  <p className="muted" {...mark(body)}>{text(body)}</p>
                </div>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 24 }} {...mark(safety.note)}>{text(safety.note)}</p>

            <div className="sub">
              <h3 {...mark(safety.howTitle)}>{text(safety.howTitle)}</h3>
              <ul className="list muted">
                {safety.how.map((line) => <li key={text(line)} {...mark(line)}>{text(line)}</li>)}
              </ul>
            </div>

            <div className="sub">
              <h3 id="results-title" {...mark(safety.resultsTitle)}>{text(safety.resultsTitle)}</h3>
              <p className="muted" {...mark(safety.resultsBody)}>{text(safety.resultsBody)}</p>
              <div className="table-wrap">
                <table className="stack" aria-labelledby="results-title">
                  <thead><tr><th scope="col">Test</th><th scope="col">Result</th></tr></thead>
                  <tbody>
                    {safety.results.map(([test, result]) => (
                      <tr key={text(test)} {...mark(test, result)}>
                        <td data-label="Test">{text(test)}</td>
                        <td data-label="Result">{text(result)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small" {...mark(safety.resultsNote)}>{text(safety.resultsNote)}</p>
            </div>
          </div>
        </section>

        <section aria-labelledby="missions-title" id="missions">
          <div className="wrap">
            <Header title={missions.title} id="missions-title" body={missions.body} />
            <p className="in-progress" data-in-progress="true" {...mark(missions.inProgress)}>{text(missions.inProgress)}</p>
          </div>
        </section>

        <section aria-labelledby="team-title" id="team">
          <div className="wrap">
            <Header title={team.title} id="team-title" />
            <div className="grid-3">
              {team.people.map(([name, role]) => (
                <div className="card" key={name}><h3>{name}</h3><p className="muted">{role}</p></div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="credits-title" id="credits">
          <div className="wrap">
            <Header title={credits.title} id="credits-title" />
            <div className="credits">
              {credits.groups.map((g) => (
                <div key={text(g.title)}>
                  <h3 {...mark(g.title)}>{text(g.title)}</h3>
                  <ul className="list muted">
                    {g.items.map(([label, href]) => (
                      <li key={text(label)} {...mark(label)}>{href ? <a href={href}>{text(label)}</a> : text(label)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="ai-title" id="ai-use">
          <div className="wrap">
            <Header title={ai.title} id="ai-title" />
            <div className="prose muted">
              {ai.lines.map((line) => <p key={text(line)} {...mark(line)}>{text(line)}</p>)}
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="wrap">
          <nav aria-label="Footer">
            <a href={DEMO}>Run the demo</a>
            <a href={REPO}>GitHub</a>
            <a href="#credits">Credits</a>
            <a href="#ai-use">AI use</a>
          </nav>
          <p>NASA Space Apps Challenge 2026. Create Health Monitoring Software for Astronauts on Space Missions. Recife local event.</p>
        </div>
      </footer>
    </>
  );
}
