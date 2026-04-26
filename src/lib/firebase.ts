import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from "firebase/app-check";
import { browserLocalPersistence, getAuth, GoogleAuthProvider, setPersistence, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};
const recaptchaSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
const enableAppCheckOnLocalhost = process.env.NEXT_PUBLIC_ENABLE_APP_CHECK_ON_LOCALHOST === "true";

export const firebaseReady = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
);

export const firebaseApp: FirebaseApp | null = firebaseReady
  ? getApps()[0] ?? initializeApp(firebaseConfig)
  : null;

function getOrbitexAppCheck(app: FirebaseApp) {
  if (typeof window === "undefined") return null;

  const appCheckGlobal = globalThis as typeof globalThis & {
    orbitexAppCheck?: AppCheck;
    orbitexAppCheckWarningShown?: boolean;
    orbitexAppCheckLocalhostWarningShown?: boolean;
    orbitexAppCheckErrorWarningShown?: boolean;
  };

  if (appCheckGlobal.orbitexAppCheck) return appCheckGlobal.orbitexAppCheck;

  if (!recaptchaSiteKey) {
    if (!appCheckGlobal.orbitexAppCheckWarningShown) {
      console.warn("Firebase App Check skipped: missing reCAPTCHA site key");
      appCheckGlobal.orbitexAppCheckWarningShown = true;
    }
    return null;
  }

  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  if (isLocalhost && !enableAppCheckOnLocalhost) {
    if (!appCheckGlobal.orbitexAppCheckLocalhostWarningShown) {
      console.warn("Firebase App Check skipped on localhost. Add localhost to reCAPTCHA domains or enable local App Check explicitly.");
      appCheckGlobal.orbitexAppCheckLocalhostWarningShown = true;
    }
    return null;
  }

  try {
    appCheckGlobal.orbitexAppCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(recaptchaSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    if (!appCheckGlobal.orbitexAppCheckErrorWarningShown) {
      const message = error instanceof Error ? error.message : "Unknown App Check error";
      console.warn("Firebase App Check initialization failed", message);
      appCheckGlobal.orbitexAppCheckErrorWarningShown = true;
    }
    return null;
  }

  return appCheckGlobal.orbitexAppCheck;
}

export const appCheck: AppCheck | null = firebaseApp ? getOrbitexAppCheck(firebaseApp) : null;
export const auth: Auth | null = firebaseApp ? getAuth(firebaseApp) : null;
export const db: Firestore | null = firebaseApp ? getFirestore(firebaseApp) : null;
export const googleProvider = new GoogleAuthProvider();

export const authPersistenceReady =
  auth && typeof window !== "undefined"
    ? setPersistence(auth, browserLocalPersistence).catch((error: Error) => {
        console.warn("[Orbitex Auth] persistence setup failed", error.message);
      })
    : Promise.resolve();
