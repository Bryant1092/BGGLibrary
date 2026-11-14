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
  /**
   * Titles on the Hot Games tables, copied from the convention page once
   * posted (normally the Saturday before BGG.CON). Searching one shows "On the
   * Hot Games tables". Plain titles are enough; matching ignores case,
   * punctuation and "(English edition)"-style text in brackets.
   */
  hotGames?: string[];
}

export const CONVENTIONS: Convention[] = [
  {
    name: 'BGG.CON 2026',
    hasHotGames: true,
    // Not posted yet as of Nov 13; add titles here when the list is out.
    hotGames: [],
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
 * under "NEW" or "CARD RACK NEW") are due in 4 hours, everything else (white
 * and yellow barcodes) in 8, and midnight to 8 AM doesn't count toward the due time.
 */
export const LIBRARY_RULES = {
  /** A shelf code containing this word means a new game (blue barcode). */
  newGameShelf: 'NEW',
  newGameHours: 4,
  otherGameHours: 8,
  /** Hours from midnight that don't count toward due times. */
  uncountedUntilHour: 8,
} as const;
