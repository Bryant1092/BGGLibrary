/**
 * Library schedule for each convention, copied from the BGG.CON / BGG.Spring
 * websites. Update this list before each convention: it drives the "Open until
 * midnight" line, due-back times (the last day closes early) and whether the
 * "not found" message mentions Hot Games.
 *
 * Times are Dallas (America/Chicago) wall-clock times. `close: '24:00'` means
 * midnight at the end of that day.
 */
export interface LibraryDay {
  /** YYYY-MM-DD in Dallas time. */
  date: string;
  /** HH:MM, 24-hour. */
  open: string;
  /** HH:MM, 24-hour; '24:00' = midnight. */
  close: string;
}

export interface Convention {
  name: string;
  /** Library days in order. The last entry is the final (short) day. */
  days: LibraryDay[];
  /** BGG.CON has a Hot Games area (not in the checkout library); BGG.Spring doesn't. */
  hasHotGames: boolean;
}

export const CONVENTIONS: Convention[] = [
  {
    name: 'BGG.CON 2026',
    hasHotGames: true,
    days: [
      { date: '2026-11-18', open: '09:00', close: '24:00' },
      { date: '2026-11-19', open: '08:00', close: '24:00' },
      { date: '2026-11-20', open: '08:00', close: '24:00' },
      { date: '2026-11-21', open: '08:00', close: '24:00' },
      { date: '2026-11-22', open: '08:00', close: '13:00' },
    ],
  },
  {
    name: 'BGG.Spring 2027',
    hasHotGames: false,
    days: [
      { date: '2027-05-27', open: '09:00', close: '24:00' },
      { date: '2027-05-28', open: '08:00', close: '24:00' },
      { date: '2027-05-29', open: '08:00', close: '24:00' },
      { date: '2027-05-30', open: '08:00', close: '24:00' },
      { date: '2027-05-31', open: '08:00', close: '13:00' },
    ],
  },
];

/**
 * Library rules shared by both conventions: new games (blue barcode, shelved
 * under "NEW") are due in 4 hours, everything else (white and yellow barcodes)
 * in 8, and midnight to 8 AM doesn't count toward the due time.
 */
export const LIBRARY_RULES = {
  newGameShelf: 'NEW',
  newGameHours: 4,
  otherGameHours: 8,
  /** Hours from midnight that don't count toward due times. */
  uncountedUntilHour: 8,
} as const;
