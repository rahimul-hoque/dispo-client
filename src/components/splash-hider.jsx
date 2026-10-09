"use client";

import { useEffect } from "react";

// Hides the native splash screen once the first page has rendered in the
// Capacitor app. No-op in a normal browser.
export function SplashHider() {
  useEffect(() => {
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;
      const { SplashScreen } = await import("@capacitor/splash-screen");
      SplashScreen.hide().catch(() => {});
    })();
  }, []);
  return null;
}
