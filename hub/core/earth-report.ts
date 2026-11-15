// The incident reports level 3 alerts file with their messages to Earth
// (engine/earth-report.ts builds them). Each is filed once, when its message
// is first listed, as a snapshot of that moment, and kept in a JSON file beside
// the database so it survives a restart. Reports older than a day are dropped.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Alert, EarthMessage } from '../engine/alerts.ts';
import type { IncidentReport } from '../engine/earth-report.ts';

const KEEP_MS = 24 * 3600_000;

export class EarthReports {
  private reports = new Map<string, IncidentReport>();
  private file: string | null;
  private build: (alert: Alert, message: EarthMessage, now: number) => IncidentReport;

  constructor(options: { file: string | null; build: (alert: Alert, message: EarthMessage, now: number) => IncidentReport }) {
    this.file = options.file;
    this.build = options.build;
    if (this.file && existsSync(this.file)) {
      try {
        const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, IncidentReport>;
        for (const [id, r] of Object.entries(saved)) if (r && r.report === 1 && typeof r.filedAt === 'number') this.reports.set(id, r);
      } catch { /* a damaged file starts empty */ }
    }
  }

  get(id: string): IncidentReport | null {
    return this.reports.get(id) ?? null;
  }

  /** Files a report for each alert message that has none yet, and puts every report on its message. */
  attach(messages: EarthMessage[], alerts: Alert[], now: number): EarthMessage[] {
    let changed = false;
    const out = messages.map((m) => {
      if (m.kind !== 'alert') return m;
      let r = this.reports.get(m.id);
      if (!r) {
        const alert = alerts.find((a) => a.earthId === m.id);
        if (!alert) return m;
        r = this.build(alert, m, now);
        this.reports.set(m.id, r);
        changed = true;
      }
      // The message's own line is the report's one-line summary.
      return { ...m, report: r, text: r.summary };
    });
    for (const [id, r] of this.reports) if (now - r.filedAt > KEEP_MS) { this.reports.delete(id); changed = true; }
    if (changed) this.save();
    return out;
  }

  private save(): void {
    if (!this.file) return;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.reports)));
      renameSync(tmp, this.file);
    } catch (err) { console.error(`earth reports not saved: ${(err as Error).message}`); }
  }
}
