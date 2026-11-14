// Astrum's own line icons, for what is tracked about a person and a room, in
// the station's stroke style.
// Each is a whole shape centred in a 24 x 24 box, about 18 units across, so a
// row of them sits on one line with even weight. Decorative: every icon sits
// inside a labelled control.

const PATHS: Record<string, string> = {
  // A heart.
  heart: 'M12 19.5s-7.5-4.6-7.5-10.1A4.1 4.1 0 0 1 12 7.1a4.1 4.1 0 0 1 7.5 2.3c0 5.5-7.5 10.1-7.5 10.1z',
  // A pressure dial: the full face, a needle and its pivot.
  pressure: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 13l3.5-4M7.5 13h1M12 7.5v1M15.5 13h1',
  // An alarm clock: woken in the night.
  wake: 'M12 6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM12 10v3l2 1.5M4.5 6.5l2.5-2.5M19.5 6.5L17 4M8 19.5l-1.5 1.5M16 19.5l1.5 1.5',
  // A bed seen from the side, with its headboard and a pillow.
  bed: 'M3.5 6v13M3.5 15.5h17V19M20.5 15.5v-3a2.5 2.5 0 0 0-2.5-2.5h-7.5v5.5M7 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  // A crescent moon.
  moon: 'M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z',
  // A dumbbell with full plates.
  dumbbell: 'M3.5 9.5v5M6.5 7v10M17.5 7v10M20.5 9.5v5M6.5 12h11',
  // A head in profile, with a mark at the temple.
  head: 'M9 20.5v-3.2A6.5 6.5 0 1 1 18 11.8l1.5 3h-1.7v2.2a1.5 1.5 0 0 1-1.5 1.5h-1.8v2M9.5 8.5l2 1M13.5 6.5l-.5 2',
  // A pulse trace inside a circle: stress.
  stress: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM6 12h2.5l1.5-3.5 2.5 7 1.5-3.5h4',
  // A face with heavy eyes: tiredness.
  tired: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8 10.5h2.5M13.5 10.5H16M9.5 15.5h5',
  // A face with closed eyes and a "z": sleepiness.
  sleepy: 'M11 4a8.5 8.5 0 1 0 9 9M7.5 11.5c.8.8 1.7.8 2.5 0M12.5 11.5c.8.8 1.7.8 2.5 0M15 3.5h4l-4 4h4',
  // A smiling face.
  mood: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM8.5 14c2 2 5 2 7 0M9 9.5v.5M15 9.5v.5',
  // CO2: an O=C=O molecule.
  co2: 'M5.2 12H9M15 12h3.8M5.2 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM23 12a2.1 2.1 0 1 1-4.2 0 2.1 2.1 0 0 1 4.2 0z',
  // Oxygen: two bubbles.
  oxygen: 'M9.5 7a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM17.5 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7.5 11.5a2.5 2.5 0 0 1 2-2',
  // Temperature: a thermometer.
  temperature: 'M10 14.5V5a2 2 0 1 1 4 0v9.5a4 4 0 1 1-4 0zM12 11v6',
  // Humidity: a drop.
  humidity: 'M12 3.5s-6 6.6-6 10.5a6 6 0 0 0 12 0c0-3.9-6-10.5-6-10.5zM9 15a3 3 0 0 0 3 3',
  // Air quality: wind with curls.
  air: 'M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h7',
  // Radiation: the three-bladed sign, drawn open.
  radiation: 'M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM10.5 9.4 7.5 4.2A8.5 8.5 0 0 0 3.5 11.5h6M13.5 9.4l3-5.2a8.5 8.5 0 0 1 4 7.3h-6M10.5 14.6l-3 5.2a8.5 8.5 0 0 0 9 0l-3-5.2',
  // Noise: a speaker and two waves.
  noise: 'M4 9.5h3l4.5-4v13L7 14.5H4zM15 9a4 4 0 0 1 0 6M17.5 6.5a7.5 7.5 0 0 1 0 11',
  // Light: the sun.
  light: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  // Vibration: a shaking line.
  vibration: 'M2.5 12h3l1.5-4 3 8 3-10 3 10 2-4h3.5',
  // Trends.
  up: 'M7 17L17 7M9.5 7H17v7.5',
  down: 'M7 7l10 10M17 9.5V17H9.5',
  flat: 'M6.5 12h11',
  // A plain dot, for anything without its own icon.
  dot: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
};

const FOR_SIGNAL: Record<string, string> = {
  heart_rate: 'heart',
  hrv: 'heart',
  blood_pressure_systolic: 'pressure',
  blood_pressure_diastolic: 'pressure',
  sleep_duration: 'moon',
  sleep_efficiency: 'bed',
  sleep_awakenings: 'wake',
  exercise_minutes: 'dumbbell',
  'checkin.headache': 'head',
  'checkin.mood': 'mood',
  'mood.stress': 'stress',
  'mood.fatigue': 'tired',
  'mood.sleepy': 'sleepy',
  co2: 'co2',
  oxygen: 'oxygen',
  temperature: 'temperature',
  humidity: 'humidity',
  pressure: 'pressure',
  air_quality: 'air',
  radiation: 'radiation',
  noise: 'noise',
  light: 'light',
  vibration: 'vibration',
};

/** A named icon that is not a signal (the trend arrows). */
export function Glyph({ name }: { name: 'up' | 'down' | 'flat' }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function SignalIcon({ signal }: { signal: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={PATHS[FOR_SIGNAL[signal] ?? 'dot']} />
    </svg>
  );
}
