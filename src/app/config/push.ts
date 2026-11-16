/**
 * Public half of the web push key pair (VAPID). Phones subscribe to push with it;
 * the server job (functions/index.js) signs notifications with the private half,
 * which is kept in Firebase's secret storage, never in the code.
 * Public by design, like a padlock anyone can see but only the key holder opens.
 */
export const VAPID_PUBLIC_KEY = 'BFXUu1DwgPuypGBfDtIRruPRlR1XGT3b49BUQQp0QWUTWxdGeFS4Jb22EDwsm1k9OknQuCGdURx1MBiBMKRFsTY';
