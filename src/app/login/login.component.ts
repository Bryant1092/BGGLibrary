import { AfterViewInit, Component, DestroyRef, inject, OnDestroy, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder, Validators, ValidatorFn, AbstractControl, ValidationErrors } from '@angular/forms';
import { Subscription, take } from 'rxjs';
import { CommonModule } from '@angular/common';
import { HideNavService } from '../service/hide-nav.service';
import { NgbModule } from '@ng-bootstrap/ng-bootstrap';
import { ActivatedRoute, Router } from '@angular/router';
import { UserService } from '../service/user.service';
import { UserCredential } from 'firebase/auth';
import { User } from '../model/user.model';
import { getAdditionalUserInfo } from '@angular/fire/auth';
import { ActiveService } from '../service/active.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, NgbModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private userService = inject(UserService);
  private activeService = inject(ActiveService)
  private destroyRef = inject(DestroyRef);
  userSubscription?: Subscription;
  loginForm!: FormGroup;
  isRegister: boolean = false;
  cantLogin: boolean = false;
  cantRegister: boolean = false;
  redirectUrl = '/';

  confirmPasswordValidator: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
    return control.value === this.loginForm?.get('password')?.value
      ? null
      : { PasswordNoMatch: true };
  };

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

  ngAfterViewInit(): void {
      this.activeService.setActiveNavTab(3)
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
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      // A 20-character cap blocks long passphrases and password-manager
      // passwords (NIST SP 800-63B says to allow at least 64), and the old
      // pattern only accepted the specials _@$!%*?&, rejecting common ones
      // like # - . or spaces. The upper/lower/number/special rule is kept,
      // but any non-alphanumeric character now counts as special.
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128), Validators.pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,128}$/)]],
      confirmPassword: ['', [Validators.required, this.confirmPasswordValidator]]
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
      } else if (passwordControl?.hasError('PasswordNoMatch')) {
        return 'Passwords do not match';
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

  togglePassword(toggleId: string, passwordId: string) {
    const togglePassword: Element = document.querySelector(`#${toggleId}`)!;
    const password = document.querySelector(`#${passwordId}`)!;
    const type = password.getAttribute('type') === 'password' ? 'text' : 'password';
    password.setAttribute('type', type);
    togglePassword.classList.toggle('bi-eye');
  }

  toggleRegister() {
    if (this.isRegister) {
      this.createLoginForm();
      this.isRegister = !this.isRegister;
    } else {
      this.createRegisterForm();
      this.isRegister = !this.isRegister;
    }
  }

  onSubmit() {
    this.userService.signUserIn(this.loginForm.value.email, this.loginForm.value.password).then((userCredential: any) => {
      // navigateByUrl, not navigate([url]): navigate treats the whole string as
      // one path segment, so a "?" or "#" in the saved URL got encoded and the
      // redirect landed on the 404 page. Same for the two redirects below.
      this.router.navigateByUrl(this.redirectUrl);
      }).catch((error: any) => {
        this.cantLogin = true;
      });
  }

  onSubmitRegister() {
    this.userService.createUser(this.loginForm.value.email, this.loginForm.value.password).then((userCredential: any) => {
      let additionalInfo = getAdditionalUserInfo(userCredential);
      // Wait for the profile to save so pages that need it don't load first.
      return this.userService.addUser({
        uid: userCredential.user.uid,
        firstName: this.loginForm.value.firstName?.trim(),
        lastName: this.loginForm.value.lastName?.trim(),
        provider: (additionalInfo?.providerId || 'firebase'),
        // Firestore rejects documents with undefined fields, so fall back to ''.
        email: userCredential.user.email?.toLocaleLowerCase() || ''
      });
    }).then(() => {
      this.router.navigateByUrl(this.redirectUrl);
    }).catch((error: any) => {
      console.error('Error registering:', error);
      this.cantRegister = true;
    });
  }

  googleLogin() {
    this.userService.signUserInWithGoogle().then((userCredential: any) => {
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
      console.error('Error logging in with Google:', error);
    });
  }

}
