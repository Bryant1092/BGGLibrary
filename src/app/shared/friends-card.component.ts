import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Friend, FriendsService, normalizeCode } from '../service/friends.service';
import { ToastService } from '../service/toast.service';
import { FriendSheetComponent } from './friend-sheet.component';
import { SheetComponent } from './sheet.component';
import { IconComponent } from './icon.component';

/**
 * Friends on the Account tab: your Meeple code to give out, adding a friend by
 * their code, requests to answer, and your friends (tap one for their page).
 *
 * Adding sends a request the other person accepts (chosen over instant add so a
 * code seen on someone's screen doesn't expose their lists). A share link
 * (…/account?meeple=MEEP-7K4Q) opens straight to "Add Alex G.?".
 */
@Component({
  selector: 'app-friends-card',
  standalone: true,
  imports: [FriendSheetComponent, SheetComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: contents; }
    /* Same card look as the rest of the Account tab (its styles don't reach inside this component). */
    .card { margin: 16px; padding: 16px; border-radius: 16px; background: var(--bl-field); display: flex; flex-direction: column; gap: 12px; }
    .card p { margin: 0; }
    h2 { margin: 0; font-size: 17px; font-weight: 700; }
    .code-box { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .code { font: 800 26px/1.1 ui-monospace, "SF Mono", Menlo, Consolas, monospace; letter-spacing: .06em; color: var(--bl-accent-text); flex: 1; min-width: 0; }
    .code-box .bl-btn { min-height: 44px; padding: 0 16px; border-radius: 22px; font-size: 15px; width: auto; }
    form { display: flex; gap: 8px; }
    /* "fr-row", not "row": Bootstrap (still loaded for old pages) styles any .row as a wrapping grid. */
    form .bl-input { flex: 1; min-width: 0; text-transform: uppercase; letter-spacing: .05em; }
    form .bl-input::placeholder { text-transform: none; letter-spacing: 0; }
    form .bl-btn { width: auto; min-height: 48px; padding: 0 18px; flex: none; }
    h3 { margin: 4px 0 0; font-size: 13px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--bl-muted); }
    .fr-row { display: flex; align-items: center; gap: 10px; min-height: 52px; border-bottom: 1px solid var(--bl-hair); }
    .fr-row:last-child { border-bottom: 0; }
    .avatar { width: 36px; height: 36px; border-radius: 18px; background: var(--bl-accent-soft); color: var(--bl-accent-text); display: flex; align-items: center; justify-content: center; font-weight: 800; flex: none; }
    .fr-row .who { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .fr-row .who small { color: var(--bl-muted); font-size: 13px; }
    .fr-row .bl-btn { width: auto; min-height: 40px; padding: 0 14px; border-radius: 20px; font-size: 14px; }
    button.fr-row { width: 100%; border: 0; border-bottom: 1px solid var(--bl-hair); background: transparent; padding: 0; text-align: left; color: inherit; font: inherit; }
    .muted { color: var(--bl-muted); font-size: 14px; margin: 0; }
    .share-ratings { display: flex; align-items: center; gap: 12px; width: 100%; border: 0; background: transparent; padding: 4px 0; text-align: left; color: inherit; font: inherit; }
    .share-ratings > span:first-child { flex: 1; display: flex; flex-direction: column; gap: 2px; }
    .share-ratings small { color: var(--bl-muted); font-size: 13px; }
  `,
  template: `
    <div class="card">
      <h2>Friends</h2>
      <div>
        <p class="muted">Your Meeple code</p>
        <div class="code-box">
          <span class="code">{{ code() || '·····' }}</span>
          <button type="button" class="bl-btn secondary" [disabled]="!code()" (click)="copy()">Copy</button>
          <button type="button" class="bl-btn secondary" [disabled]="!code()" (click)="shareCode()">Share</button>
        </div>
      </div>
      <p class="muted">Friends add you with this code. They see your lists that have "Friends can see" on, and you see theirs.</p>
      <!-- On by default (the group says "liked it" out loud anyway); one switch turns it off. -->
      <button type="button" class="share-ratings" role="switch" [attr.aria-checked]="shareRatings()" (click)="toggleShareRatings()">
        <span><strong>Friends can see my ratings</strong><small>Your 👍 / 👎 show in Friends' picks and on your friend page</small></span>
        <span class="bl-switch" aria-hidden="true"></span>
      </button>

      <form (submit)="$event.preventDefault(); lookUp(codeInput.value)">
        <label class="visually-hidden" for="friend-code">Friend's Meeple code</label>
        <input #codeInput id="friend-code" class="bl-input" placeholder="Friend's code (MEEP-…)" autocomplete="off"
               autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="send" maxlength="12">
        <button type="submit" class="bl-btn" [disabled]="busy()">Add</button>
      </form>

      @if (friends.incoming().length) {
        <h3>Requests · {{ friends.incoming().length }}</h3>
        <div>
          @for (f of friends.incoming(); track f.uid) {
            <div class="fr-row">
              <span class="avatar" aria-hidden="true">{{ initial(f) }}</span>
              <span class="who"><strong>{{ f.name }}</strong><small>wants to be friends</small></span>
              <button type="button" class="bl-btn" (click)="accept(f)">Accept</button>
              <button type="button" class="bl-btn secondary" [attr.aria-label]="'Decline ' + f.name" (click)="remove(f, 'Declined')">✕</button>
            </div>
          }
        </div>
      }
      @if (outgoing().length) {
        <h3>Waiting for them to accept</h3>
        <div>
          @for (f of outgoing(); track f.uid) {
            <div class="fr-row">
              <span class="avatar" aria-hidden="true">{{ initial(f) }}</span>
              <span class="who"><strong>{{ f.name }}</strong><small>{{ f.code }}</small></span>
              <button type="button" class="bl-btn secondary" (click)="remove(f, 'Request cancelled')">Cancel</button>
            </div>
          }
        </div>
      }
      <h3>Your friends · {{ friends.accepted().length }}</h3>
      @if (friends.accepted().length) {
        <div>
          @for (f of friends.accepted(); track f.uid) {
            <button type="button" class="fr-row" (click)="open.set(f)">
              <span class="avatar" aria-hidden="true">{{ initial(f) }}</span>
              <span class="who"><strong>{{ f.name }}</strong><small>See what you both want</small></span>
              <bl-icon name="chevronRight" [size]="18" />
            </button>
          }
        </div>
      } @else {
        <p class="muted">None yet. Share your code with your group, or add theirs above.</p>
      }
    </div>

    @if (confirm(); as c) {
      <app-sheet [label]="'Add ' + c.name" (closed)="confirm.set(null)">
        <h2>Add {{ c.name }}?</h2>
        <p class="bl-sheet-note">They'll get a request. Once they accept, you'll each see the other's lists that have "Friends can see" on.</p>
        <button type="button" class="bl-btn" [disabled]="busy()" (click)="send(c.code)">Send request</button>
        <button type="button" class="bl-btn secondary" (click)="confirm.set(null)">Cancel</button>
      </app-sheet>
    }
    @if (open(); as f) {
      <app-friend-sheet [friend]="f" (closed)="open.set(null)" />
    }
  `,
})
export class FriendsCardComponent implements OnInit {
  friends = inject(FriendsService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  code = signal('');
  shareRatings = signal(true);
  busy = signal(false);
  confirm = signal<{ code: string; name: string } | null>(null);
  open = signal<Friend | null>(null);
  outgoing = computed(() => this.friends.list().filter(f => f.status === 'outgoing'));

  ngOnInit(): void {
    this.friends.myCode().then(c => { this.code.set(c.code); return this.friends.shareRatings(); }).then(on => this.shareRatings.set(on))
      .catch(() => this.toast.error("Couldn't load your Meeple code. Check your connection."));
    // A shared link: …/account?meeple=MEEP-7K4Q opens "Add Alex G.?". The parameter is
    // dropped right away so a reload doesn't ask again.
    const shared = this.route.snapshot.queryParamMap.get('meeple');
    if (shared) {
      this.router.navigate([], { queryParams: { meeple: null }, queryParamsHandling: 'merge', replaceUrl: true });
      this.lookUp(shared);
    }
  }

  initial(f: Friend): string {
    return (f.name.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase();
  }

  /** Checks the code and shows who it belongs to before sending anything. */
  async lookUp(input: string): Promise<void> {
    const code = normalizeCode(input);
    if (!code) { this.toast.error('That doesn\'t look like a Meeple code. It\'s 4 letters/numbers, like MEEP-7K4Q.'); return; }
    if (code === this.code()) { this.toast.error("That's your own code."); return; }
    this.busy.set(true);
    try {
      const found = await this.friends.lookup(code);
      if (!found) { this.toast.error(`No one has the code ${code}. Check it with your friend.`); return; }
      const existing = this.friends.list().find(f => f.uid === found.uid);
      if (existing?.status === 'friends') { this.toast.show({ text: `You're already friends with ${found.name}` }); return; }
      if (existing?.status === 'outgoing') { this.toast.show({ text: `Still waiting for ${found.name} to accept` }); return; }
      this.confirm.set({ code, name: found.name });
    } catch {
      this.toast.error("Couldn't check that code. Check your connection.");
    } finally {
      this.busy.set(false);
    }
  }

  async send(code: string): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.friends.sendRequest(code);
      this.confirm.set(null);
      const input = document.getElementById('friend-code') as HTMLInputElement | null;
      if (input) input.value = '';
      this.toast.show({ text: r.result === 'accepted' ? `You and ${r.name} are now friends` : `Request sent to ${r.name}` });
    } catch {
      this.toast.error("Couldn't send the request. Check your connection.");
    } finally {
      this.busy.set(false);
    }
  }

  accept(f: Friend): void {
    this.friends.accept(f.uid).then(() => this.toast.show({ text: `You and ${f.name} are now friends` }))
      .catch(() => this.toast.error("Couldn't accept. Check your connection."));
  }

  remove(f: Friend, done: string): void {
    this.friends.remove(f.uid).then(() => this.toast.show({ text: done }))
      .catch(() => this.toast.error("That didn't work. Check your connection."));
  }

  toggleShareRatings(): void {
    const next = !this.shareRatings();
    this.shareRatings.set(next);
    this.friends.setShareRatings(next)
      .then(() => this.toast.show({ text: next ? 'Friends can see your ratings' : 'Your ratings are private' }))
      .catch(() => { this.shareRatings.set(!next); this.toast.error("Couldn't change that. Check your connection."); });
  }

  copy(): void {
    navigator.clipboard?.writeText(this.code())
      .then(() => this.toast.show({ text: 'Code copied' }))
      .catch(() => this.toast.show({ text: `Your code is ${this.code()}` }));
  }

  /** Phone share sheet (Messages, etc.) with a link that opens "Add …?"; falls back to copying. */
  shareCode(): void {
    const url = new URL('account', document.baseURI);
    url.searchParams.set('meeple', this.code());
    const text = `Add me on BGG Library so we can see which games we both want. My Meeple code: ${this.code()}`;
    if (navigator.share) {
      navigator.share({ title: 'My Meeple code', text, url: url.toString() }).catch(() => { /* closed the share sheet */ });
    } else {
      navigator.clipboard?.writeText(`${text}\n${url}`).then(() => this.toast.show({ text: 'Link copied' }));
    }
  }
}
