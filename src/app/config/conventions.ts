/**
 * Library schedule for each convention. It drives the "Open until midnight"
 * line, due-back times (the last day closes early), the Events tab and whether
 * the "not found" message mentions Hot Games.
 *
 * Nothing here needs editing each year any more: the app finds the next
 * BGG.CON / BGG.Spring on Tabletop.Events at startup (service/convention-sync.ts)
 * and builds the days from its dates with LIBRARY_HOURS below. CONVENTIONS is
 * only the starting point used until that first answer arrives (or offline on
 * a first visit). CONVENTION_OVERRIDES is for a year that breaks the pattern.
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
  /**
   * The convention's id on Tabletop.Events, used to load its event schedule
   * (Events tab). Find it with
   * https://tabletop.events/api/convention?query=<name> once the convention exists.
   */
  tteConventionId?: string;
}

export const CONVENTIONS: Convention[] = [
  {
    name: 'BGG.CON 2026',
    tteConventionId: 'CC4FC78E-17EC-11F1-9082-3FD444321FD1',
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
    tteConventionId: '930C9118-A6FE-11F1-BA8A-B416C6434C85',
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

/**
 * Library hours, the same at every BGG.CON and BGG.Spring so far (2021–2027,
 * from the convention websites): the first day opens when the convention
 * starts (9 AM), the other days at 8 AM, every day closes at midnight except
 * the last, which closes at 1 PM. Tabletop.Events lists the convention's dates
 * but not the library's hours, so this pattern fills them in.
 */
export const LIBRARY_HOURS = {
  otherDaysOpen: '08:00',
  close: '24:00',
  lastDayClose: '13:00',
} as const;

/** The BGG library on Tabletop.Events. Only conventions using it are picked up. */
export const BGG_LIBRARY_ID = '0AEB11DA-2B7D-11EC-B400-855F800FD618';

/**
 * Changes for one convention, by its exact Tabletop.Events name. Leave empty in a
 * normal year. Examples:
 *   'BGG.CON 2027': { days: [...] }          // the library keeps different hours
 *   'BGG.CON 2027': { hotGames: ['Ants'] }   // Hot Games titles the news post missed
 *
 * Hot Games are read from the convention's news post automatically
 * (util/hot-games.ts); titles listed here are added to those.
 */
export const CONVENTION_OVERRIDES: Record<string, Partial<Convention>> = {};
