import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chypher.dispo',
  appName: 'Dispo',
  // Not actually used for content — kept only because Capacitor's CLI
  // expects webDir to point at an existing folder. The real app content
  // comes from server.url below instead, since this app relies on real
  // server-side sessions, API routes, and middleware that can't be
  // bundled as a static local build.
  webDir: 'public',
  // WebView background while the remote site loads — matches the splash
  // instead of the default (black in dark mode).
  backgroundColor: '#F5F6F1',
  server: {
    url: 'https://dispo-client.vercel.app',
    cleartext: false,
  },
  plugins: {
    // Splash stays up while the remote site loads; SplashHider (in the root
    // layout) hides it as soon as the first page has rendered. The duration
    // is only a safety cutoff so a failed load can't leave it stuck forever.
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 10000,
      launchFadeOutDuration: 250,
      backgroundColor: '#F5F6F1',
      androidScaleType: 'CENTER_CROP',
      showSpinner: true, // shown on Android 11 and below; 12+ shows the icon only
      androidSpinnerStyle: 'large',
      spinnerColor: '#FF5D00',
    },
    // Only Google is wired up (see src/lib/google-native-auth.js) — the
    // other providers would otherwise bundle their SDKs for nothing.
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
    },
  },
};

export default config;
