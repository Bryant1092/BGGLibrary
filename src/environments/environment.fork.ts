/**
 * Firebase for the test site on Bryant's fork (bryant1092.github.io/BGGLibrary).
 *
 * A separate project (bgg-library-test) so features can be tried with real
 * sign-in and lists without touching the real app's users. Only used when built
 * with `--configuration production,fork`; the normal production build still uses
 * environment.prod.ts, so merging the fork's code changes nothing for the real app.
 *
 * These values are public by design (every Firebase web app ships them); access
 * is controlled by firestore.rules.
 */
export const environment = {
    production: true,
    firebase: {
        apiKey: "AIzaSyCslrud5ZwOSWTL8Wufhr4IMQohqN9QyPs",
        authDomain: "bgg-library-test.firebaseapp.com",
        projectId: "bgg-library-test",
        storageBucket: "bgg-library-test.firebasestorage.app",
        messagingSenderId: "1032850817004",
        appId: "1:1032850817004:web:1bcd78b774c6210c368ac9",
        measurementId: "G-D7BYT026J4"
    }
};
