/// <reference types="@angular/localize" />

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { startAnalyticsWhenIdle } from './app/util/analytics';

bootstrapApplication(AppComponent, appConfig)
  // After bootstrap, so the Firebase app already exists (see util/analytics.ts).
  .then(() => startAnalyticsWhenIdle())
  .catch((err) => console.error(err));
