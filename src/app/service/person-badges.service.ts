import { Injectable, computed, inject, signal } from '@angular/core';
import { FriendsService } from './friends.service';
import { UserService } from './user.service';

/** Number of friend colors (--bl-p0 … --bl-p6 in styles.css). */
export const PERSON_COLORS = 7;

export interface PersonBadge {
  /** Two letters, e.g. "BG" for "Bryant G." ("Br" / "Bo" when two people share both). */
  initials: string;
  /** 0–6 for a friend (--bl-pN colors), 'me' for you (the orange accent). */
  color: number | 'me';
  /** Full display name for labels ("You" for yourself). */
  name: string;
}

/**
 * Who's who in Friends' picks and on the Account tab: two initials plus a color per
 * friend, the same in every place a friend's circle appears.
 *
 * Why (research, 2026-11-17): one letter clashed for friends with the same first letter,
 * and every circle was the same grey. Color alone isn't enough (WCAG 1.4.1, and about 1
 * in 12 men is color-blind), and people only keep about 6–8 colors apart, so it's two
 * initials AND a color, with a key of names on Friends' picks.
 *
 * Colors: each friend's account id picks a starting color, so most people keep the same
 * color on everyone's phone; if two of your friends would get the same one, the later one
 * (by account id) moves to the next free color, so on your phone no two friends share a
 * color until you have more than 7. Never based on the name, so renaming keeps the color.
 */
@Injectable({ providedIn: 'root' })
export class PersonBadges {
  private friends = inject(FriendsService);
  private user = inject(UserService);
  /** Your own name ("Bryant G."), for your initials; the lists only call you "You". */
  private myName = signal('');
  private myUid = signal<string | null>(null);

  constructor() {
    this.user.checkAuth().subscribe((u: any) => {
      this.myUid.set(u?.uid ?? null);
      this.myName.set('');
      if (u) this.friends.myCode().then(p => this.myName.set(p.name || '')).catch(() => { /* initials fall back to "Y" */ });
    });
  }

  private table = computed(() => {
    const me = this.myUid();
    const people = [
      ...(me ? [{ uid: me, name: this.myName() || 'You' }] : []),
      ...this.friends.accepted().map(f => ({ uid: f.uid, name: f.name })),
    ];
    const initials = assignInitials(people);
    const colors = assignColors(people.filter(p => p.uid !== me).map(p => p.uid));
    const map = new Map<string, PersonBadge>();
    for (const p of people) {
      map.set(p.uid, { initials: initials.get(p.uid)!, color: p.uid === me ? 'me' : colors.get(p.uid)!, name: p.uid === me ? 'You' : p.name });
    }
    return map;
  });

  /** Badge for anyone; someone not (yet) in the friends list still gets stable initials and a color. */
  badge(uid: string, name: string): PersonBadge {
    const known = this.table().get(uid);
    if (known) return known;
    if (uid === this.myUid() || name === 'You') return { initials: initialsOf(this.myName() || 'You', 0), color: 'me', name: 'You' };
    return { initials: initialsOf(name, 0), color: hash(uid) % PERSON_COLORS, name };
  }
}

/** "Bryant G." -> "BG"; one word -> first two letters ("Cher" -> "Ch"). level 1 = first two letters of the first name. */
export function initialsOf(name: string, level: 0 | 1): string {
  const words = name.trim().split(/[\s.]+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (!words.length) return '?';
  const first = words[0];
  if (level === 1 || words.length === 1) return (first.charAt(0).toUpperCase() + (first.charAt(1) || '').toLowerCase()) || '?';
  return (first.charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
}

/**
 * Two initials ("BG"). People who'd share them get their first name's first letter plus
 * the first letter where their first names differ: Bryant G. / Brandon G. -> "By" / "Ba"
 * (plain "first two letters" gave "Br" / "Br", still the same).
 */
export function assignInitials(people: { uid: string; name: string }[]): Map<string, string> {
  const base = people.map(p => ({ uid: p.uid, name: p.name, i: initialsOf(p.name, 0) }));
  const groups = new Map<string, typeof base>();
  base.forEach(b => groups.set(b.i, [...(groups.get(b.i) || []), b]));
  const out = new Map<string, string>();
  for (const [initials, group] of groups) {
    if (group.length === 1) { out.set(group[0].uid, initials); continue; }
    const firsts = group.map(g => (g.name.trim().split(/[\s.]+/)[0] || '').replace(/[^\p{L}\p{N}]/gu, ''));
    const longest = Math.max(...firsts.map(f => f.length));
    let picked: string[] | null = null;
    for (let i = 1; i < longest && !picked; i++) {
      const tries = firsts.map(f => f.charAt(0).toUpperCase() + (f.charAt(i) || f.charAt(f.length - 1)).toLowerCase());
      if (new Set(tries).size === tries.length) picked = tries;
    }
    // Same first name and last initial (two "Alex G."): the colors still tell them apart.
    group.forEach((g, k) => out.set(g.uid, picked ? picked[k] : initialsOf(g.name, 1)));
  }
  return out;
}

/** Distinct colors while there are 7 or fewer friends; each starts from its account id's color. */
export function assignColors(uids: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const used = new Set<number>();
  for (const uid of [...uids].sort()) {
    let c = hash(uid) % PERSON_COLORS;
    if (used.size < PERSON_COLORS) while (used.has(c)) c = (c + 1) % PERSON_COLORS;
    used.add(c);
    out.set(uid, c);
  }
  return out;
}

/** Small stable string hash (FNV-1a). */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
