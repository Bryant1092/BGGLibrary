/** A piece of a description: plain text, or a link, optionally bold. */
export interface RichSegment {
  text: string;
  href?: string;
  bold?: boolean;
}

/**
 * Tabletop.Events descriptions are plain text with a little Markdown that
 * organizers type by hand. Checked Nov 2026 across BGG.CON's 345 events and
 * 56 exhibitors: 27 bare URLs, 11 Markdown links "[Discord](https://…)", 4
 * "www.example.com" addresses and 94 "**bold**" bits (which showed up as
 * literal asterisks). Only these are handled; everything else stays as text.
 *
 * Order matters: bold first (its inside can hold a link), then Markdown links,
 * then bare addresses. Markdown links may also be "mailto:" (BGG Store's contact
 * address); bare email addresses are left as text.
 */
const TOKEN = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)|(https?:\/\/[^\s<>]+|\bwww\.[^\s<>]+\.[^\s<>]+)/g;

export function parseRichText(text: string): RichSegment[] {
  const out: RichSegment[] = [];
  parseInto(text, false, out);
  return out;
}

/** Same text without the Markdown, for one-line previews ("**Ardonis**" → "Ardonis"). */
export function plainText(text: string): string {
  return parseRichText(text).map(s => s.text).join('');
}

function parseInto(text: string, bold: boolean, out: RichSegment[]): void {
  const add = (seg: RichSegment) => {
    if (!seg.text) return;
    if (bold) seg = { ...seg, bold: true }; // mark first, so bold never merges into plain text below
    const last = out[out.length - 1];
    // Merge neighbouring plain text of the same weight so the template renders fewer nodes.
    if (last && !last.href && !seg.href && !!last.bold === !!seg.bold) last.text += seg.text;
    else out.push(seg);
  };
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    const [whole, boldInner, mdText, mdUrl, bare] = m;
    add({ text: text.slice(at, m.index) });
    at = m.index! + whole.length;
    if (boldInner !== undefined) {
      if (bold) add({ text: boldInner });
      else parseInto(boldInner, true, out);
    } else if (mdText !== undefined) {
      add({ text: mdText, href: mdUrl });
    } else {
      // Sentence punctuation right after an address isn't part of it:
      // "…sign-up)." and "https://cafemomentum.org/," in real descriptions.
      const { url, rest } = trimUrl(bare);
      add({ text: url, href: url.startsWith('www.') ? `https://${url}` : url });
      add({ text: rest });
    }
  }
  add({ text: text.slice(at) });
}

function trimUrl(url: string): { url: string; rest: string } {
  let rest = '';
  for (;;) {
    const last = url.slice(-1);
    const unbalancedParen = last === ')' && count(url, '(') < count(url, ')');
    if (/[.,;:!?'"*]/.test(last) || unbalancedParen) {
      rest = last + rest;
      url = url.slice(0, -1);
    } else {
      return { url, rest };
    }
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}
