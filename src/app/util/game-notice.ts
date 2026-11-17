/**
 * "Know before you check it out" notes for one library copy: missing pieces, missing
 * rules, damage, and helpful extras ("English rules included").
 *
 * Why: about 1 in 50 library games has a problem the library already wrote down
 * (110 flagged missing pieces, 182 with notes, Nov 2026), but the app never showed it,
 * so people found out at the table mid-setup ("Missing a few cards, playable with at
 * least 4"). The data comes with every game record the app already loads, so this
 * costs no extra requests, and it updates if the library edits a note during the con.
 *
 * The notes are written by library staff for each other, so they're cleaned first:
 * - people's names and badge numbers are removed (privacy), keeping what's missing;
 * - staff bookkeeping is dropped ("FIX Fall23", "Swap Sept 2026", "swapped with 2025 edition").
 *
 * Each copy has its own record and catalog number (BGG-263028), so a note belongs to
 * that exact copy: with two copies, the other one may be complete.
 */

/** The fields this needs; every Tabletop.Events library game record has them. */
export interface NoticeSource {
  missing_components?: number | string | null;
  missing_instructions?: number | string | null;
  box_unacceptable?: number | string | null;
  overall_condition?: string | null;
  condition_notes?: string | null;
  catalog_number?: string | null;
}

export interface GameNotice {
  /** 'warn': something is missing or damaged. 'info': a helpful extra, nothing wrong. */
  level: 'warn' | 'info';
  /** Short label for list rows: "Missing pieces", "No rulebook", "Note". */
  tag: string;
  /** Full sentence(s) for the details sheet, names removed. */
  text: string;
  /** The copy's library number, e.g. "BGG-263028" (to tell copies apart). */
  copy: string;
}

/** Notes that are only staff bookkeeping about replacing the copy: not a problem with it. */
const BOOKKEEPING_ONLY = /^\s*(swap(ped)?\b|game board found\.?\s*$)/i;

/** Problem words: a note with any of these is a warning, otherwise it's just good to know. */
const PROBLEM = /missing|broken|break|unplayable|only play|playable (at|to|up to|with|by)|plays up to|replaced|substitut|needs?\b|rip(ped|ping)?\b|damage|falling apart|separated|crush|not in english|cannot|can only|glue|taped/i;

export function cleanNote(raw: string): string {
  let t = ' ' + raw.replace(/\s+/g, ' ').trim() + ' ';
  // Staff markers: "FIX Fall23", "F2022", "HL - 11/2023 -", "Update 1:".
  t = t.replace(/\bFIX\s+(Fall|Spring)\d{2}\b/gi, ' ')
       .replace(/\bF20\d{2}\b/g, ' ')
       .replace(/\b[A-Z]{2,3}\s*-\s*\d{1,2}\/\d{4}\s*-\s*/g, ' ')
       .replace(/\bUpdate \d+:\s*/gi, ' ')
       .replace(/\bTo be reviewed:\s*/gi, ' ');
  // People: "Badge 3579 (Lori Sarten) says…" -> "an attendee says…";
  // "Jeff Anderson borrowed…" -> "Someone borrowed…"; "(First Last)" -> "".
  t = t.replace(/\bbadge\s*#?\s*\d+\s*(\([^)]*\))?/gi, '. An attendee ')
       .replace(/\(\s*[A-Z][a-z]+(\s+[A-Z][a-z'-]+)+\s*\)/g, ' ')
       .replace(/\b[A-Z][a-z]+\s+[A-Z][a-z'-]+(?=\s+(borrowed|has|have|had|took|takes|kept|keeps|says|said|is|was|will|returned|brought)\b)/g, 'Someone')
       .replace(/\bI was told\s*/gi, ' ')
       .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, 'the publisher');
  t = t.replace(/\s+([.,;:])/g, '$1').replace(/\.{2,}/g, '.').replace(/\s{2,}/g, ' ').replace(/^[\s.,;:-]+/, '').trim();
  // Sentence case after removing a leading marker; "an attendee" at the start.
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function gameNotice(g: NoticeSource | null | undefined): GameNotice | null {
  if (!g) return null;
  const copy = (g.catalog_number || '').trim();
  const rawNote = (g.condition_notes || '').trim();
  const note = rawNote && !BOOKKEEPING_ONLY.test(rawNote) ? cleanNote(rawNote) : '';
  const missing = Number(g.missing_components) > 0;
  const noRules = Number(g.missing_instructions) > 0;
  const badBox = Number(g.box_unacceptable) > 0;
  const condition = (g.overall_condition || '').toLowerCase();
  const unplayable = condition === 'unplayable';

  const problem = missing || noRules || badBox || unplayable || condition === 'fair' || (!!note && PROBLEM.test(note));
  if (problem) {
    const tag = unplayable ? 'Unplayable' : noRules ? 'No rulebook' : missing || /missing/i.test(note) ? 'Missing pieces' : badBox ? 'Damaged box' : 'Note';
    const fallback = unplayable ? 'The library marked this copy unplayable.'
      : missing ? "Missing some pieces (the library didn't say which)."
      : noRules ? 'The rulebook is missing.'
      : badBox ? 'The box is damaged.'
      : 'The library notes this copy is in fair condition.';
    return { level: 'warn', tag, text: note || fallback, copy };
  }
  if (note) return { level: 'info', tag: 'Note', text: note, copy };
  return null;
}
