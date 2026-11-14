// The two demo cards, written the way a steps card would name its moves. The
// story card's steps are the recorded scenario's own beats; the compressions
// card is an example whose numbers come from the cited guideline (SOURCES.md)
// and which is not reviewed by the medical lead.

import type { CardStep } from './step.ts';

export interface Card { id: string; title: string; steps: CardStep[]; reviewed: boolean }

export const CARDS: Card[] = [
  {
    id: 'reyes-co2',
    title: 'Reyes · Quarters 2 · CO2 over NASA’s limit',
    reviewed: false,
    steps: [
      { move: 'go-to', gravity: 'weightless', params: { from: 'galley', to: 'quarters-2', helper: 'Okafor', person: 'Reyes', asleep: 1 }, title: 'Go to her', line: 'Go to Quarters 2.' },
      { move: 'rouse-lead-out', gravity: 'weightless', params: { room: 'quarters-2', helper: 'Okafor', person: 'Reyes' }, title: 'Wake her and bring her out', line: 'Take her arm and guide her out through the hatch.' },
      { move: 'stay-at-table', gravity: 'weightless', params: { room: 'galley', helper: 'Okafor', person: 'Reyes' }, title: 'Move to the Galley and stay with her', line: 'Hold position at the table and stay with her.' },
    ],
  },
  {
    id: 'compressions-example',
    title: 'Example · chest compressions',
    reviewed: false,
    steps: [
      { move: 'compressions', gravity: 'gravity', title: 'Chest compressions', line: 'Lower half of the breastbone, about 5 cm, 100 to 120 a minute, full recoil.' },
    ],
  },
];
