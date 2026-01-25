import { logEvent } from "firebase/analytics";
import { getFirebaseAnalytics } from "./firebaseClient.js";

export async function trackEvent(name, params = {}) {
  const analytics = await getFirebaseAnalytics();
  if (!analytics) return;
  try {
    logEvent(analytics, name, params);
  } catch {}
}
