// "Reset Astrum" (Settings, production mode only): erases everything this hub
// has stored and starts again at the first-run setup. The route only leaves a
// marker and restarts; the erase happens at the next start, before any file is
// opened (applyPendingReset, called first thing in core/main.ts), so nothing
// is deleted from under an open database.
//
// Kept: the model file a crew may have put in "models", and "launch.env" (the
// app's own settings). Everything else in the data folder goes: every
// mission's readings, alerts, events, reports, the crew and their photos.

import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { setupFile } from './setup.ts';

const MARKER = 'reset.pending';
const KEPT = new Set(['models', 'launch.env']);

/** If a reset was asked for, erases the data folder (but what is kept) and marks the setup as still to do. */
export function applyPendingReset(dataDir: string): boolean {
  if (!existsSync(join(dataDir, MARKER))) return false;
  for (const name of readdirSync(dataDir)) {
    if (!KEPT.has(name)) rmSync(join(dataDir, name), { recursive: true, force: true });
  }
  writeFileSync(setupFile(dataDir), `${JSON.stringify({ setupDone: false })}\n`);
  return true;
}

export type ResetOptions = {
  dataDir: string;
  production: boolean;
  supervised: boolean;
  restart?: () => void;
};

/** POST /api/reset {"confirm":"erase everything"}: production mode only, and only a hub that can restart itself. */
export function resetRoute(opts: ResetOptions) {
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== '/api/reset') return false;
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      return true;
    };
    if (req.method !== 'POST') return json(405, { error: 'method not allowed' });
    if (!opts.production) return json(409, { error: 'Reset is for the real app (production mode). In demo mode, use "Run setup again".' });
    if (!opts.supervised || !opts.restart) return json(409, { error: 'This hub was started without its supervisor, so it cannot restart itself to reset.' });
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { body = null; }
    if ((body as { confirm?: unknown } | null)?.confirm !== 'erase everything') return json(400, { error: 'needs {"confirm":"erase everything"}' });
    writeFileSync(join(opts.dataDir, MARKER), '');
    res.once('finish', () => opts.restart?.());
    return json(200, { resetting: true });
  };
}
