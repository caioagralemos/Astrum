// A sensor board's name on screen: its room and a number ("Commons 1", "Lab 1"),
// counted among the boards in the same room in id order. Move a board and its
// name follows. The id the board announces ("chip:cabin-1") stays underneath.

import type { Profile, SourceStatus } from '../../../engine/types.ts';

type S = (key: string, vars?: Record<string, string | number>) => string;

/** The room a board is in: what it says, else where the profile puts it. */
export function boardRoom(src: SourceStatus, profile: Pick<Profile, 'chips'>): string | null {
  return src.room ?? profile.chips[src.id.replace(/^chip:/, '')] ?? null;
}

/** "Commons 1" for a board; its id for any other source, or a board with no room. */
export function boardName(src: SourceStatus, sources: SourceStatus[], profile: Pick<Profile, 'chips' | 'rooms'>, s: S, rooms: Record<string, string> = {}): string {
  if (!src.id.startsWith('chip:')) return src.id;
  const room = rooms[src.id] ?? boardRoom(src, profile);
  if (!room) return src.id;
  const same = sources.filter((x) => x.id.startsWith('chip:') && (rooms[x.id] ?? boardRoom(x, profile)) === room).map((x) => x.id).sort();
  const roomKey = profile.rooms.find((r) => r.id === room)?.name ?? room;
  return `${s(roomKey)} ${same.indexOf(src.id) + 1}`;
}
