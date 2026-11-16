import { DestroyRef, inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwPush } from '@angular/service-worker';
import { doc, Firestore, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { combineLatest } from 'rxjs';
import { VAPID_PUBLIC_KEY } from '../config/push';
import { UserService } from './user.service';

/**
 * Registers this phone for push notifications, so "X is back" arrives even when
 * the app is closed (sent by the server job in functions/index.js).
 *
 * Uses Angular's SwPush (the standard Push API through the app's existing service
 * worker): works in Chrome/Edge/Firefox and in iPhone Home Screen apps (iOS 16.4+).
 * Each phone's push address is saved under the account (users/{uid}/pushSubs).
 * Not available in a regular Safari tab on iPhone or in local development
 * (service worker off); bells then still alert while the app is open.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private swPush = inject(SwPush);
  private firestore = inject(Firestore);
  private userService = inject(UserService);

  get supported(): boolean {
    return this.swPush.isEnabled && typeof Notification !== 'undefined';
  }

  /**
   * Asks for permission and subscribes. Must run from a tap (Safari requires it).
   * Returns the resulting permission ('granted', 'denied' or 'default').
   */
  async subscribe(): Promise<NotificationPermission> {
    if (!this.supported) {
      return typeof Notification !== 'undefined' ? Notification.requestPermission() : 'denied';
    }
    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: VAPID_PUBLIC_KEY });
      await this.save(sub);
    } catch (err) {
      console.warn('Push subscription failed', err);
    }
    return Notification.permission;
  }

  /**
   * Called once from AppComponent: when signed in with notifications already
   * allowed, keeps this phone's push address saved (browsers can rotate it, and a
   * new account on the same phone needs its own copy).
   */
  start(destroyRef: DestroyRef): void {
    if (!this.supported) return;
    combineLatest([this.userService.checkAuth(), this.swPush.subscription])
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe(([user, sub]) => {
        if (user && sub) this.save(sub).catch(() => { /* tried again next start */ });
      });
  }

  private save(sub: PushSubscription): Promise<void> {
    const uid = this.userService.getCurrentUid();
    if (!uid) return Promise.resolve();
    // One document per phone: a short hash of its push address as the id.
    return setDoc(doc(this.firestore, 'users', uid, 'pushSubs', hash(sub.endpoint)), { sub: sub.toJSON(), at: serverTimestamp() });
  }
}

/** Short, stable id for a push address (cyrb53). */
function hash(text: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
