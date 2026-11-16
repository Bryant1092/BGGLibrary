import { HttpClient, HttpParams } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal, WritableSignal } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';
import { CONVENTIONS, Convention } from '../config/conventions';
import { postSnippet, postTopics } from '../util/con-html';
import { hotGamesFromPosts, setNewsHotGames } from '../util/hot-games';
import { currentOrNextConvention, formatLibraryTime, LIBRARY_TIME_ZONE } from '../util/library-time';
import { parseTteDate } from '../util/time-ago';

/** A news post BGG publishes on Tabletop.Events (also emailed to badge holders). */
export interface NewsPost {
  id: string;
  title: string;
  /** When it was published and emailed (ms). Posts are often written a day earlier. */
  postedAt: number;
  html: string;
  /** Section titles, for the preview ("Covers: …"). Empty when the post has none. */
  topics: string[];
  /** First real sentence, used as the preview when there are no section titles. */
  snippet: string;
  url: string;
}

/** One of the convention's info pages (Library Information, Tips & Tricks…). */
export interface GuidePage {
  id: string;
  name: string;
  html: string;
  /** Set for pages that are just a link elsewhere (opened in a new tab). */
  link: string;
}

const API = 'https://tabletop.events/api';
const READ_KEY = 'bgglibrary.news.read';
const PROMPTED_KEY = 'bgglibrary.news.prompted';
const CACHE_PREFIX = 'bgglibrary.conInfo.';
/** BGG posts about once a day around the con (19 posts per con in 2024 and 2025), so this is plenty. */
const CHECK_EVERY_MS = 15 * 60_000;
/** Switching back to the app re-checks, but not more often than this. */
const MIN_RECHECK_MS = 5 * 60_000;
/** Info pages hardly change (Library Information last changed in March), so twice a day is enough. */
const PAGES_MAX_AGE_MS = 12 * 60 * 60_000;
/**
 * On first use, posts older than this count as already read. Otherwise someone
 * installing the app the week of the con would get a badge of 8 for months-old
 * posts (hotel links from March…). Recent ones still show as new.
 */
const FIRST_RUN_NEW_WINDOW_MS = 3 * 24 * 60 * 60_000;

interface Cache {
  posts: NewsPost[];
  pages: GuidePage[];
  postsAt: number;
  pagesAt: number;
}

/**
 * News posts and info pages for the current convention, from Tabletop.Events.
 *
 * - Checked when the app opens, when you come back to it, and every 15 minutes
 *   while it's open. There's no server, so nothing can alert you while the app
 *   is closed; Tabletop.Events already emails every post to badge holders.
 * - A copy is kept on the phone (localStorage, ~150 KB), so the guide and posts
 *   open on bad convention Wi-Fi even if the browser dropped its cache.
 * - Which posts you've read, and which the new-post message has already shown,
 *   are remembered on this phone (like bells and stars).
 */
@Injectable({ providedIn: 'root' })
export class ConInfoService {
  private http = inject(HttpClient);

  readonly convention: Convention | undefined = currentOrNextConvention() ?? CONVENTIONS[CONVENTIONS.length - 1];
  private conId = this.convention?.tteConventionId || '';
  private cache = this.readCache();

  readonly posts = signal<NewsPost[] | null>(this.cache?.posts ?? null);
  readonly pages = signal<GuidePage[] | null>(this.cache?.pages ?? null);
  readonly postsError = signal(false);
  readonly pagesError = signal(false);
  readonly pagesLoading = signal(false);
  /** When the guide was last saved on this phone (for "Saved for offline"). */
  readonly pagesSavedAt = signal(this.cache?.pagesAt ?? 0);

  private readIds = signal<Set<string>>(this.readSet(READ_KEY));
  private promptedIds = signal<Set<string>>(this.readSet(PROMPTED_KEY));
  private firstRun = this.readStorage(READ_KEY) === null;
  private lastCheck = 0;
  private checking = false;

  /** Unread posts, newest first. Drives the number on the Events tab. */
  readonly unread = computed(() => (this.posts() || []).filter(p => !this.readIds().has(p.id)));
  readonly unreadCount = computed(() => this.unread().length);
  /** Unread posts the new-post message hasn't shown yet. */
  readonly toAnnounce = computed(() => this.unread().filter(p => !this.promptedIds().has(p.id)));

  constructor() {
    // Hot Games from the saved posts, so search knows them before the network answers.
    setNewsHotGames(hotGamesFromPosts(this.posts() || []));
  }

  /** Called once from AppComponent so new posts are noticed on every tab. */
  start(destroyRef: DestroyRef): void {
    if (!this.conId) return;
    // Waits for the browser to be idle so it never competes with the first screen loading.
    const idle = (window as any).requestIdleCallback || ((fn: () => void) => setTimeout(fn, 1500));
    idle(() => { this.checkNews(); this.loadPages(); });
    const timer = setInterval(() => { if (document.visibilityState === 'visible') this.checkNews(); }, CHECK_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - this.lastCheck > MIN_RECHECK_MS) this.checkNews();
    };
    document.addEventListener('visibilitychange', onVisible);
    destroyRef.onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    });
  }

  /** Fetches the news posts (one small request). */
  /** Resolves true when posts came back, false if the check failed (for the refresh button's message). */
  checkNews(): Promise<boolean> {
    if (!this.conId || this.checking) return Promise.resolve(false);
    this.checking = true;
    this.lastCheck = Date.now();
    return new Promise(resolve => this.fetchPosts().subscribe(posts => {
      this.checking = false;
      if (!posts) {
        this.postsError.set(!this.posts());
        resolve(false);
        return;
      }
      this.postsError.set(false);
      if (this.firstRun) {
        // See FIRST_RUN_NEW_WINDOW_MS.
        this.firstRun = false;
        const old = posts.filter(p => Date.now() - p.postedAt > FIRST_RUN_NEW_WINDOW_MS).map(p => p.id);
        this.addTo(this.readIds, READ_KEY, old);
        this.addTo(this.promptedIds, PROMPTED_KEY, old);
      }
      this.posts.set(posts);
      // BGG posts the final Hot Games list in the news; pick it up without an app update.
      setNewsHotGames(hotGamesFromPosts(posts));
      this.saveCache({ posts, postsAt: Date.now() });
      resolve(true);
    }));
  }

  /** Loads the info pages unless a recent copy is saved (force = pull again). */
  loadPages(force = false): void {
    if (!this.conId || this.pagesLoading()) return;
    if (!force && this.pages() && Date.now() - this.pagesSavedAt() < PAGES_MAX_AGE_MS) return;
    this.pagesLoading.set(true);
    const params = new HttpParams().set('_items_per_page', 100).set('_order_by', 'sequence_number');
    this.http.get<any>(`${API}/convention/${this.conId}/pages`, { params }).pipe(
      map(r => (r?.result?.items || []).map((p: any): GuidePage => ({
        id: p.id,
        name: (p.name || '').trim(),
        html: p.description_html || '',
        link: p.is_link == 1 && /^https?:\/\//.test(p.link_uri || '') ? p.link_uri : '',
      })).filter((p: GuidePage) => p.name && (p.html.trim() || p.link))),
      catchError(err => {
        console.error('Failed to load con guide pages', err);
        return of(null);
      })
    ).subscribe(pages => {
      this.pagesLoading.set(false);
      if (!pages) {
        this.pagesError.set(!this.pages());
        return;
      }
      this.pagesError.set(false);
      this.pages.set(pages);
      this.pagesSavedAt.set(Date.now());
      this.saveCache({ pages, pagesAt: Date.now() });
    });
  }

  isRead(id: string): boolean {
    return this.readIds().has(id);
  }

  /** Opening a post marks it read (and the badge goes down), as Apple's guidelines ask. */
  markRead(id: string): void {
    this.addTo(this.readIds, READ_KEY, [id]);
    this.addTo(this.promptedIds, PROMPTED_KEY, [id]);
  }

  markAllRead(): void {
    const ids = (this.posts() || []).map(p => p.id);
    this.addTo(this.readIds, READ_KEY, ids);
    this.addTo(this.promptedIds, PROMPTED_KEY, ids);
  }

  /** "Later" / ×: stop showing the message for these posts; they stay unread (the badge stays). */
  dismissAnnouncement(ids: string[]): void {
    this.addTo(this.promptedIds, PROMPTED_KEY, ids);
  }

  /** "Today · 8:16 PM", "Yesterday · 8:16 PM" or "Wed, Nov 11 · 4:32 PM", in Dallas time. */
  postedText(ms: number, now = Date.now()): string {
    const time = formatLibraryTime(ms, ms).replace(/ CT$/, '');
    const suffix = formatLibraryTime(now, now).endsWith(' CT') ? ' CT' : '';
    const day = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: LIBRARY_TIME_ZONE }).format(new Date(t));
    const diff = Math.round((Date.parse(day(now)) - Date.parse(day(ms))) / 86_400_000);
    const date = diff === 0 ? 'Today' : diff === 1 ? 'Yesterday'
      : new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: LIBRARY_TIME_ZONE });
    return `${date} · ${time}${suffix}`;
  }

  private fetchPosts(): Observable<NewsPost[] | null> {
    const params = new HttpParams().set('_items_per_page', 100);
    return this.http.get<any>(`${API}/convention/${this.conId}/updates`, { params }).pipe(
      map(r => (r?.result?.items || [])
        // Drafts have no publish date; only published posts were emailed out.
        .filter((u: any) => u.published == 1 && u.date_posted)
        .map((u: any): NewsPost => {
          const title = (u.name || '').trim();
          const html = u.body_html || '';
          return {
            id: u.id,
            title,
            postedAt: parseTteDate(u.date_posted)?.getTime() || 0,
            html,
            topics: postTopics(html, title, 4),
            snippet: postSnippet(html),
            url: u.view_uri ? `https://tabletop.events${u.view_uri}` : '',
          };
        })
        .sort((a: NewsPost, b: NewsPost) => b.postedAt - a.postedAt)),
      catchError(err => {
        console.error('Failed to load news', err);
        return of(null);
      })
    );
  }

  private addTo(target: WritableSignal<Set<string>>, key: string, ids: string[]): void {
    if (!ids.length) return;
    const next = new Set(target());
    ids.forEach(id => next.add(id));
    target.set(next);
    // Capped so the list can't grow forever across conventions.
    this.writeStorage(key, JSON.stringify([...next].slice(-300)));
  }

  private readSet(key: string): Set<string> {
    try {
      return new Set(JSON.parse(this.readStorage(key) || '[]'));
    } catch {
      return new Set();
    }
  }

  private readCache(): Cache | null {
    try {
      return JSON.parse(this.readStorage(CACHE_PREFIX + this.conId) || 'null');
    } catch {
      return null;
    }
  }

  private saveCache(part: Partial<Cache>): void {
    this.cache = { posts: [], pages: [], postsAt: 0, pagesAt: 0, ...this.cache, ...part };
    this.writeStorage(CACHE_PREFIX + this.conId, JSON.stringify(this.cache));
  }

  private readStorage(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStorage(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch { /* storage full or blocked (private mode): it still works until the app closes */ }
  }
}
