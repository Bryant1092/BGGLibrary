import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ConInfoService } from '../service/con-info.service';
import { IconComponent } from './icon.component';

/**
 * "New from BGG" message, shown above the tab bar on any tab when BGG has
 * published a post you haven't seen. Each post is announced once.
 *
 * It stays until you choose Read, Later or ×, instead of disappearing on a
 * timer: messages people are meant to read and act on shouldn't vanish before
 * slower readers finish (WCAG 2.2.1 Timing Adjustable; GitHub Primer's toast
 * guidance). Later/× only hides the message; the post stays unread, so the
 * number on the Events tab still counts it.
 *
 * The preview lists the post's section titles because BGG's posts open with a
 * greeting ("Hello BGG.CON Attendees!…") that says nothing about the contents.
 */
@Component({
  selector: 'app-news-prompt',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (posts().length) {
      <section class="bl-news-prompt" role="status" aria-live="polite" aria-label="New from BGG">
        <div class="head">
          <span class="badge-icon" aria-hidden="true"><bl-icon name="megaphone" [size]="16" [stroke]="2.2" /></span>
          <span class="kicker">{{ kicker() }}</span>
          <button type="button" class="close" aria-label="Dismiss" (click)="later()"><bl-icon name="close" [size]="20" [stroke]="2.2" /></button>
        </div>
        @for (p of shown(); track p.id) {
          <div class="post">
            <strong>{{ p.title }}</strong>
            <span>{{ p.preview }}</span>
          </div>
        }
        @if (posts().length > shown().length) {
          <span class="more">and {{ posts().length - shown().length }} more</span>
        }
        <div class="actions">
          <button type="button" class="read" (click)="read()">{{ posts().length === 1 ? 'Read' : 'Read them' }}</button>
          <button type="button" class="later" (click)="later()">Later</button>
        </div>
      </section>
    }
  `,
})
export class NewsPromptComponent {
  private info = inject(ConInfoService);
  private router = inject(Router);

  posts = this.info.toAnnounce;
  /** Two at most, so the message never covers half the screen; the rest are "and N more". */
  shown = computed(() => this.posts().slice(0, 2).map(p => ({
    id: p.id,
    title: p.title,
    preview: p.topics.length ? 'Covers: ' + p.topics.slice(0, 3).join(' · ') : p.snippet,
  })));
  kicker = computed(() => {
    const posts = this.posts();
    const when = posts[0] ? this.info.postedText(posts[0].postedAt).replace(/^Today · /, '') : '';
    return posts.length === 1 ? `New from BGG · ${when}` : `${posts.length} new posts from BGG`;
  });

  /** Opens the Info view; with a single post, opens that post directly. */
  read(): void {
    const posts = this.posts();
    this.info.dismissAnnouncement(posts.map(p => p.id));
    this.router.navigate(['/events'], { queryParams: { view: 'info', post: posts.length === 1 ? posts[0].id : null } });
  }

  later(): void {
    this.info.dismissAnnouncement(this.posts().map(p => p.id));
  }
}
