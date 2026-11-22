/**
 * Bells on any copy (2026-11-20).
 *
 * A bell is saved on one copy: the library record on your list (e.g. Hell of a Deal has five,
 * BGG-260038 … BGG-260611). Until now only that record coming back sent "is back", so another
 * copy could sit on the shelf unnoticed. Now any copy of the same game counts.
 *
 * "Same game" = the same name, ignoring case and outer spaces, exactly like the app's copies list
 * (BggService.copiesOf), so different editions ("(English edition)" vs "(German edition)") stay
 * separate games.
 *
 * Pure functions, no Firebase or network, so they can be tested with `node --test functions/test`.
 */

/** The copies key for a game name. '' when there's no name (never matches). */
function copyKey(name) {
  return String(name || '').trim().toLowerCase();
}

/**
 * Which bells a list of check-ins answers.
 *
 * @param items Tabletop.Events games, newest check-in first (one page of the check-in list).
 * @param bellNames Map bell's game id -> its copies key (copyKey of its name), or '' if unknown.
 * @param since Only check-ins at or after this time (ms) count.
 * @param tteTime Parses a Tabletop.Events date to ms.
 * @returns { back: Map bellId -> the copy on the shelf (newest check-in wins), older: boolean }.
 *   `older` = the list reached check-ins before `since`, so later pages aren't needed.
 */
function matchCheckins(items, bellNames, since, tteTime) {
  const byKey = new Map();
  for (const [id, key] of bellNames) {
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) || []), id]);
  }
  const back = new Map();
  let older = false;
  for (const g of items) {
    if (tteTime(g.last_checkin_date) < since) { older = true; break; }
    // Taken again before this check (e.g. 65 s on the shelf): nothing to send.
    if (Number(g.is_checked_out) !== 0) continue;
    // The bell's own record, even when its name isn't known yet.
    if (bellNames.has(g.id) && !back.has(g.id)) back.set(g.id, g);
    for (const bellId of byKey.get(copyKey(g.name)) || []) {
      if (!back.has(bellId)) back.set(bellId, g);
    }
  }
  return { back, older };
}

/**
 * The copies of one game from a Tabletop.Events name search (which also returns other games
 * whose names contain the words), newest check-in first, ready for matchCheckins.
 * Dates are 'YYYY-MM-DD HH:MM:SS' in UTC, so comparing the strings sorts them by time.
 */
function sameGameCopies(items, key) {
  return items.filter(g => key && copyKey(g.name) === key)
    .sort((a, b) => String(b.last_checkin_date || '').localeCompare(String(a.last_checkin_date || '')));
}

module.exports = { copyKey, matchCheckins, sameGameCopies };
