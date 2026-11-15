// Asking the hub for something on demand (history, the evidence card), with a
// refresh. The live state itself always comes through data.ts.

import { useEffect, useState } from 'react';
import { hubAddress, isReplay } from './data.ts';

export type Load<T> = { state: 'loading' } | { state: 'ready'; value: T } | { state: 'failed' };

export function useHub<T>(path: string | null, every = 60_000): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    if (!path) return;
    // A recorded story has no hub to ask: say so at once (the views' own "needs the hub" state), never a spinner.
    if (isReplay()) { setLoad({ state: 'failed' }); return; }
    let live = true;
    setLoad({ state: 'loading' });
    const get = () => fetch(`http://${hubAddress()}${path}`)
      .then((r) => (r.ok ? r.json() as Promise<T> : Promise.reject(new Error(String(r.status)))))
      .then((value) => { if (live) setLoad({ state: 'ready', value }); })
      .catch(() => { if (live) setLoad((old) => (old.state === 'ready' ? old : { state: 'failed' })); });
    void get();
    const timer = setInterval(get, every);
    return () => { live = false; clearInterval(timer); };
  }, [path, every]);
  return load;
}
