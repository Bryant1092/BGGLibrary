/**
 * Helpers for the HTML that BGG writes in Tabletop.Events news posts and info
 * pages. That HTML is written for email (inline colors, fonts, tables), so it's
 * cleaned before being shown in the app, where it has to work in dark mode and
 * on a phone-width screen.
 */

/**
 * Section titles of a news post, for its preview ("Covers: Open gaming tables ·
 * Quiet games · …"). BGG's posts all open with a greeting ("Hello BGG.CON
 * Attendees! How are your adventures…"), so the first lines say little; the
 * bold/heading lines are what tell you what's inside.
 *
 * Checked against every 2025 and 2026 BGG.CON post. Emphasis that isn't a
 * section title is skipped: numbers ("2916" attendees, "$1,965"), dates and
 * times ("November 17", "Saturday 10:00am to 6:00pm"), and one-word shouts
 * ("NOTE:", "AND", "LOTS").
 */
export function postTopics(html: string, title = '', max = 4): string[] {
  const found: string[] = [];
  const seen = new Set<string>([normalize(title)]);
  const tag = /<(h[1-6]|strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(tag)) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().replace(/[\s:–—-]+$/, '');
    const key = normalize(text);
    if (!isTopic(text) || seen.has(key)) continue;
    seen.add(key);
    found.push(text);
    if (found.length >= max) break;
  }
  return found;
}

/**
 * Preview for a post without section titles (e.g. 2025's short "Missing items"
 * post): its first real sentence, skipping the "Hello BGG.CON Attendees!"
 * greeting, cut to about one line and a half.
 */
export function postSnippet(html: string, maxLength = 110): string {
  let text = decodeEntities((html || '').replace(/<br\s*\/?>|<\/(p|div|li|h\d)>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  // Greetings name the convention ("Hello BGG.CON 2025 Attendees!"), whose dot
  // would end a simple "up to the first period" match early; skip through the
  // greeting word instead, else up to the first sentence end.
  const greeting = /^(hello|hi|hey|greetings|dear|howdy)\b.{0,60}?\b(attendees|everyone|all|friends|folks|gamers|geeks)\s*[!.,]\s*/i;
  text = greeting.test(text) ? text.replace(greeting, '') : text.replace(/^(hello|hi|hey|greetings|dear|howdy)\b[^!?]{0,60}[!?,]\s*/i, '');
  // "CON Attendees," when the greeting itself was cut off in the post.
  text = text.replace(/^(bgg\.)?con attendees\s*[,!]\s*/i, '');
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), maxLength - 20)).replace(/[\s,;:–-]+$/, '') + '…';
}

const MONTHS ='january|february|march|april|may|june|july|august|september|october|november|december';
const DAYS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';

function isTopic(text: string): boolean {
  if (text.length < 4 || text.length > 48) return false;
  const letters = text.replace(/[^a-z]/gi, '');
  if (letters.length < 4) return false; // "2916", "$1,965", "1PM"
  const lower = text.toLowerCase();
  if (new RegExp(`^(${DAYS})?,?\\s*(${MONTHS})\\b`).test(lower)) return false; // "November 17, 2026", "Monday, November 16"
  if (new RegExp(`^(${DAYS})\\b.*\\d`).test(lower)) return false; // "Saturday 10:00am to 6:00pm"
  if (/^(midnight|noon)$/.test(lower)) return false;
  if (/^previous\b.*\b(updates?|news)\b/.test(lower)) return false; // the archive link at the end of every post
  if (/@|https?:|www\./.test(lower)) return false; // email addresses and links in bold
  // Filler titles that appear in most posts and say nothing about this one.
  if (/^(announcements? for the day|read thoroughly|reservation link|important notes?)$/.test(lower)) return false;
  // A single word in capitals is emphasis inside a sentence ("NOTE", "LOTS", "AND"), not a heading.
  if (!/\s/.test(text) && text === text.toUpperCase()) return false;
  return true;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Dropped together with everything inside them (code, embeds, forms, media). */
const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'FRAME', 'FRAMESET', 'OBJECT', 'EMBED', 'APPLET', 'FORM', 'INPUT', 'BUTTON',
  'SELECT', 'TEXTAREA', 'LINK', 'META', 'BASE', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'HEAD']);
/** Kept as-is (minus attributes). Anything else (<font>, <center>, <span style>…) is unwrapped: its text stays, the tag goes. */
const KEEP = new Set(['P', 'BR', 'DIV', 'A', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
  'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'IMG', 'HR', 'BLOCKQUOTE', 'SUB', 'SUP']);

/**
 * Cleans post/page HTML for display. It's an allowlist: only the tags in KEEP
 * survive, with only these attributes:
 *  - a href: web, email and phone links only (no javascript: etc.). Other
 *    sites open in a new tab with rel="noopener" so they can't reach back;
 *    Tabletop.Events links that start with "/" get the full address.
 *  - id/name (letters, digits, - and _ only): BGG's posts start with a table
 *    of contents of "#section" links, which ConHtmlComponent scrolls to.
 *  - img src (https only) and alt; td/th colspan/rowspan (numbers).
 * Every style, class, color and font from the email version is removed, so the
 * text follows the app's type and works in dark mode.
 *
 * Because nothing outside this allowlist survives, the result is safe to
 * bind with bypassSecurityTrustHtml. Angular's default sanitizer would also
 * strip the ids, which breaks those in-post links.
 */
export function cleanConHtml(html: string): string {
  // DOMParser builds an inert document: scripts in it never run and images don't load.
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  cleanChildren(root);
  // Empty paragraphs (<p>&nbsp;</p>) are email spacing; they'd leave big gaps. Kept when
  // they hold a jump target: BGG marks sections as <p><a name="hot"></a></p>.
  root.querySelectorAll('p, div').forEach(el => {
    if (!el.textContent?.trim() && !el.querySelector('img, table, hr, [id]')) el.remove();
  });
  return root.innerHTML;
}

function cleanChildren(parent: Element): void {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.COMMENT_NODE) { node.remove(); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP.has(tag)) { el.remove(); continue; }
    cleanChildren(el);
    if (!KEEP.has(tag)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
    cleanAttributes(el, tag);
  }
}

function cleanAttributes(el: Element, tag: string): void {
  const href = (el.getAttribute('href') || '').trim();
  const src = (el.getAttribute('src') || '').trim();
  const alt = el.getAttribute('alt') || '';
  const anchor = (el.getAttribute('id') || el.getAttribute('name') || '').trim();
  const span = { colspan: el.getAttribute('colspan'), rowspan: el.getAttribute('rowspan') };
  for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);

  if (/^[\w-]{1,80}$/.test(anchor)) el.setAttribute('id', anchor);
  if (tag === 'A' && href) {
    if (/^#[\w-]{1,80}$/.test(href)) {
      el.setAttribute('href', href);
    } else {
      const full = href.startsWith('/') && !href.startsWith('//') ? `https://tabletop.events${href}` : href;
      if (/^(https?:\/\/|mailto:|tel:)/i.test(full)) {
        el.setAttribute('href', full);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener');
      }
    }
  }
  if (tag === 'IMG') {
    if (/^https:\/\//i.test(src)) {
      el.setAttribute('src', src);
      el.setAttribute('alt', alt);
      el.setAttribute('loading', 'lazy');
    } else {
      el.remove();
    }
  }
  if (tag === 'TD' || tag === 'TH') {
    if (/^\d{1,2}$/.test(span.colspan || '')) el.setAttribute('colspan', span.colspan!);
    if (/^\d{1,2}$/.test(span.rowspan || '')) el.setAttribute('rowspan', span.rowspan!);
  }
}
