import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { reportUnnamedSignals } from '../../engine/strings.ts';

// A signal with no name in the string table is shown in plain words; in development, say which.
if (import.meta.env.DEV) reportUnnamedSignals((signal) => console.warn(`No name in engine/strings.ts for signal "${signal}"`));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
