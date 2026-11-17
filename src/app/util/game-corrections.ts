/**
 * Player counts and play times the library's own records are missing (Tabletop.Events has a
 * minimum of 2 and no maximum for these, so they matched no Players filter). Filled in from
 * the boxes / BoardGameGeek by the app owner, 2026-11-17. Expansions use their base game:
 * Cards Against Humanity 4–20 (4–8 ideal, 20+ possible), Ostia 1–4, Thunderverse = Thunder
 * Alley 2–7. AEW Dice Knock Out: one set plays 2 (more only by combining several sets).
 *
 * Only fills gaps: a value is used when the library's own is missing (0), so once the library
 * fixes its record, theirs wins. Keyed by library game id (one per copy).
 */
interface Correction { minPlayers?: number; maxPlayers?: number; minMinutes?: number; maxMinutes?: number; }

const CAH = { minPlayers: 4, maxPlayers: 20 };
const CORRECTIONS: Record<string, Correction> = {
  'F5B8A710-E061-11F1-AEE7-F67AC355D01A': { minPlayers: 2, maxPlayers: 2, minMinutes: 15, maxMinutes: 30 }, // AEW Dice Knock Out: Set 02
  '67511208-B2D7-11F1-99C2-F30774285BAE': CAH, // Cards Against Humanity Twists: Shit List
  'EA841512-B2D7-11F1-B809-93429D8299CF': CAH, // Cards Against Humanity: Hot Box
  'E9F10B18-B2D8-11F1-B809-CD8B4F4539E1': CAH, // Cards Against Humanity: Tales Vol 2
  'DA5640D4-7A07-11F0-BE33-F15DABAE8E50': { minPlayers: 2, maxPlayers: 2, minMinutes: 10, maxMinutes: 10 }, // Cows in Space
  '1409D924-F17E-11F0-8BF9-089458394341': { minPlayers: 1, maxPlayers: 4, minMinutes: 100, maxMinutes: 120 }, // Ostia: Merchant Expansion
  'FBC29FC2-F17D-11F0-A7B7-1005C1A3EF6D': { minPlayers: 1, maxPlayers: 4, minMinutes: 100, maxMinutes: 120 }, // Ostia: Patronus Expansion
  '96B7BE1C-B475-11F1-8772-E6CB9E9691F4': { minPlayers: 2, maxPlayers: 7, minMinutes: 60, maxMinutes: 120 }, // Thunderverse Track Pack
};

/** A library game record (Tabletop.Events field names), with missing player counts / times filled in. */
export function correctGame<T extends { id?: string; min_players?: any; max_players?: any; min_play_time?: any; max_play_time?: any }>(g: T): T {
  const c = g?.id ? CORRECTIONS[g.id] : undefined;
  if (!c || Number(g.max_players) > 0) return g; // nothing missing: the library's numbers win
  return {
    ...g,
    min_players: c.minPlayers ?? g.min_players, max_players: c.maxPlayers ?? g.max_players,
    min_play_time: c.minMinutes ?? g.min_play_time, max_play_time: c.maxMinutes ?? g.max_play_time,
  };
}

/** Same, for the pre-built search and shelf lists (their own field names). */
export function correctRow<T extends { id: string; minPlayers: number; maxPlayers: number; minMinutes: number; maxMinutes: number }>(r: T): T {
  const c = CORRECTIONS[r.id];
  if (!c || r.maxPlayers > 0) return r;
  return { ...r, minPlayers: c.minPlayers ?? r.minPlayers, maxPlayers: c.maxPlayers ?? r.maxPlayers, minMinutes: c.minMinutes ?? r.minMinutes, maxMinutes: c.maxMinutes ?? r.maxMinutes };
}
