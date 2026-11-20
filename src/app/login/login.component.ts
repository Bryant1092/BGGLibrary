import { Component, DestroyRef, inject, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder, Validators } from '@angular/forms';
import { Subscription, take } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HideNavService } from '../service/hide-nav.service';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../service/user.service';
import { UserCredential } from 'firebase/auth';
import { User } from '../model/user.model';
import { getAdditionalUserInfo } from '@angular/fire/auth';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private destroyRef = inject(DestroyRef);
  userSubscription?: Subscription;
  loginForm!: FormGroup;
  isRegister: boolean = false;
  cantLogin: boolean = false;
  /**
   * True between "the account is confirmed" and leaving this page. Google sign-in
   * then saves/checks the profile (1-2 s on phone data); before, the login form just
   * sat there and looked stuck, so a "Signing you in…" overlay shows instead.
   */
  signingIn = false;
  cantRegister: boolean = false;
  redirectUrl = '/';

  /**
   * Set when Sign in / Create account is tapped with something missing. The buttons stay
   * enabled (audit 2026-11-20): a greyed-out button never said what was wrong, so now the tap
   * shows each problem under its field and moves to the first one.
   */
  submitted = false;

  constructor(private hideNavService: HideNavService) {
    this.createLoginForm();
  }

  ngOnInit(): void {
    // takeUntilDestroyed: this subscription was never closed, so every visit to
    // the login page left one behind.
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const requested = params['redirectUrl'] ? decodeURIComponent(params['redirectUrl']) : '/';
      // Only accept in-app paths. Anything else (a typo, or a crafted link
      // like ?redirectUrl=https://...) just goes to the home page.
      this.redirectUrl = requested.startsWith('/') ? requested : '/';
    });
  }

  ngOnDestroy(): void {
    this.hideNavService.setHideNav(false);
    this.userSubscription?.unsubscribe();
  }

  createLoginForm() {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      // No maximum length when signing in: the form must never reject a
      // password that Firebase would accept, and checking the password
      // itself is Firebase's job.
      password: ['', [Validators.required, Validators.minLength(8)]],
    });
  }

  createRegisterForm() {
    this.loginForm = this.fb.group({
      // One Name field (audit 2026-11-20): split into first name + last initial on save, the
      // same way as Google sign-in names.
      name: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      // A 20-character cap blocks long passphrases and password-manager
      // passwords (NIST SP 800-63B says to allow at least 64), and the old
      // pattern only accepted the specials _@$!%*?&, rejecting common ones
      // like # - . or spaces. The upper/lower/number/special rule is kept,
      // but any non-alphanumeric character now counts as special.
      // No "type it again" field: Show lets you check it, and the confirm field cost more
      // sign-ups than it saved (GOV.UK removed theirs for the same reason).
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128), Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,128}$/)]],
    });
  }

  checkPasswordErrors(passwordType: string) {
    const passwordControl = this.loginForm.get(passwordType);
    if (passwordControl?.invalid) {
      if (passwordControl?.hasError('required')) {
        return 'Password is required';
      } else if (passwordControl?.hasError('minlength')) {
        return 'Password must be at least 8 characters long';
      } else if (passwordControl?.hasError('maxlength')) {
        return 'Password must be no more than 128 characters long';
      } else if (passwordControl?.hasError('pattern')) {
        return 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character';
      }
    }
    return null;
  }

  checkEmailErrors() {
    const emailControl = this.loginForm.get('email');
    if (emailControl?.invalid) {
      if (emailControl?.hasError('required')) {
        return 'Email is required';
      } else if (emailControl?.hasError('email')) {
        return 'Please enter a valid email address';
      }
    }
    return null;
  }

  /** False when something is missing: shows every error and moves focus to the first one. */
  private readyToSubmit(): boolean {
    if (this.loginForm.valid) return true;
    this.submitted = true;
    this.loginForm.markAllAsTouched();
    const first = ['name', 'email', 'password'].find(k => this.loginForm.get(k)?.invalid);
    if (first) setTimeout(() => document.getElementById(first === 'name' ? 'login-name' : 'login-' + first)?.focus());
    return false;
  }

  toggleRegister() {
    this.submitted = false;
    this.isReset = false;
    this.clearMessages();
    if (this.isRegister) {
      this.createLoginForm();
      this.isRegister = !this.isRegister;
    } else {
      this.createRegisterForm();
      this.isRegister = !this.isRegister;
    }
  }

  // ---------- Added with the redesign (Nov 2026) ----------

  /** "Forgot password?" mode: just an email box and "Send reset link". */
  isReset = false;
  resetSent = false;
  /** Show/Hide on the password boxes (was a DOM toggle tied to an icon font). */
  showPassword = false;
  /** One plain-language message for whatever went wrong, shown above the form. */
  errorText = '';
  busy = false;

  private clearMessages(): void {
    this.errorText = '';
    this.cantLogin = false;
    this.cantRegister = false;
    this.resetSent = false;
  }

  openReset(): void {
    const email = this.loginForm.value.email || '';
    this.clearMessages();
    this.isReset = true;
    this.isRegister = false;
    this.createLoginForm();
    this.loginForm.patchValue({ email });
  }

  backToSignIn(): void {
    const email = this.loginForm.value.email || '';
    this.clearMessages();
    this.isReset = false;
    this.isRegister = false;
    this.createLoginForm();
    this.loginForm.patchValue({ email });
  }

  sendReset(): void {
    const email = (this.loginForm.value.email || '').trim();
    if (!email || this.loginForm.get('email')?.invalid) { this.errorText = 'Enter the email you signed up with.'; return; }
    this.busy = true;
    this.clearMessages();
    this.userService.sendPasswordReset(email)
      .then(() => this.resetSent = true)
      .catch((error: any) => this.errorText = this.friendlyError(error?.code))
      .finally(() => this.busy = false);
  }

  /**
   * The sign-up password rules as a checklist that ticks off while typing, instead of
   * one long error after a mistake. Same rules as createRegisterForm's pattern.
   */
  get passwordChecks(): { label: string; ok: boolean }[] {
    const p: string = this.loginForm.get('password')?.value || '';
    return [
      { label: '8+ characters', ok: p.length >= 8 },
      { label: 'Upper and lower case', ok: /[a-z]/.test(p) && /[A-Z]/.test(p) },
      { label: 'A number', ok: /\d/.test(p) },
      { label: 'A symbol (like ! # ?)', ok: /[^A-Za-z\d]/.test(p) },
    ];
  }

  /** Firebase error codes in plain words. */
  private friendlyError(code: string | undefined): string {
    switch (code) {
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
      case 'auth/invalid-login-credentials':
        return "That email and password don't match. Try again, or tap \"Forgot password?\"";
      case 'auth/email-already-in-use':
        return 'That email already has an account. Sign in instead.';
      case 'auth/invalid-email':
        return "That email address doesn't look right.";
      case 'auth/weak-password':
        return 'Choose a longer password.';
      case 'auth/too-many-requests':
        return 'Too many tries. Wait a few minutes, then try again.';
      case 'auth/network-request-failed':
        return "Couldn't connect. Check your Wi-Fi or cellular and try again.";
      case 'auth/popup-blocked':
        return 'Your browser blocked the Google window. Allow pop-ups for this site, or use email.';
      default:
        return 'Something went wrong. Try again.';
    }
  }

  onSubmit() {
    if (this.busy || !this.readyToSubmit()) return;
    this.busy = true;
    this.clearMessages();
    this.userService.signUserIn(this.loginForm.value.email, this.loginForm.value.password).then((userCredential: any) => {
      this.signingIn = true;
      // navigateByUrl, not navigate([url]): navigate treats the whole string as
      // one path segment, so a "?" or "#" in the saved URL got encoded and the
      // redirect landed on the 404 page. Same for the two redirects below.
      this.router.navigateByUrl(this.redirectUrl);
      }).catch((error: any) => {
        this.cantLogin = true;
        this.errorText = this.friendlyError(error?.code);
      }).finally(() => this.busy = false);
  }

  onSubmitRegister() {
    if (this.busy || !this.readyToSubmit()) return;
    this.busy = true;
    this.clearMessages();
    this.userService.createUser(this.loginForm.value.email, this.loginForm.value.password).then((userCredential: any) => {
      let additionalInfo = getAdditionalUserInfo(userCredential);
      // Wait for the profile to save so pages that need it don't load first.
      return this.userService.addUser({
        uid: userCredential.user.uid,
        ...UserService.splitDisplayName(this.loginForm.value.name, userCredential.user.email),
        provider: (additionalInfo?.providerId || 'firebase'),
        // Firestore rejects documents with undefined fields, so fall back to ''.
        email: userCredential.user.email?.toLocaleLowerCase() || ''
      });
    }).then(() => {
      this.router.navigateByUrl(this.redirectUrl);
    }).catch((error: any) => {
      console.error('Error registering:', error);
      this.cantRegister = true;
      this.errorText = this.friendlyError(error?.code);
    }).finally(() => this.busy = false);
  }

  googleLogin() {
    this.clearMessages();
    this.userService.signUserInWithGoogle().then((userCredential: any) => {
      this.signingIn = true;
      const googleUser = userCredential.user;
      // The old displayName.split(' ')[1] gave undefined for one-word names
      // (and crashed on a missing name), which made Firestore reject the profile.
      const { firstName, lastName } = UserService.splitDisplayName(googleUser.displayName, googleUser.email);
      // Runs on every Google sign-in, not just new users, so accounts whose
      // profile failed to save before get repaired.
      return this.userService.ensureUserProfile({
        uid: googleUser.uid,
        firstName,
        lastName,
        provider: userCredential.providerId || 'google.com',
        email: googleUser.email?.toLocaleLowerCase() || ''
      });
    }).then(() => {
      this.router.navigateByUrl(this.redirectUrl);
    }).catch(error => {
      this.signingIn = false;
      console.error('Error logging in with Google:', error);
      // Closing the Google window isn't an error worth a message.
      if (error?.code !== 'auth/popup-closed-by-user' && error?.code !== 'auth/cancelled-popup-request') {
        this.errorText = this.friendlyError(error?.code);
      }
    });
  }

}
