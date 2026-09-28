import posthog from 'posthog-js';
import type { TelemetryAPI } from '@openchamber/ui/lib/api/types';

interface DesktopBridgeGlobal {
  __OPENCHAMBER_DESKTOP__?: {
    trackTelemetryEvent?: (name: string, props?: Record<string, string | number | boolean>) => void;
  };
}

function getPostHogConfig() {
  // SAFETY: Safely accessing optional import.meta.env properties for Vite/web bundlers.
  const metaEnv = (import.meta as { env?: Record<string, string | undefined> }).env;
  const processEnv = globalThis.process?.env;

  const appKey =
    metaEnv?.VITE_POSTHOG_APP_KEY ||
    metaEnv?.POSTHOG_APP_KEY ||
    processEnv?.VITE_POSTHOG_APP_KEY ||
    processEnv?.POSTHOG_APP_KEY ||
    '';
  const hostUrl =
    metaEnv?.VITE_POSTHOG_HOST_URL ||
    metaEnv?.POSTHOG_HOST_URL ||
    processEnv?.VITE_POSTHOG_HOST_URL ||
    processEnv?.POSTHOG_HOST_URL ||
    'https://eu.i.posthog.com';

  return { appKey, hostUrl };
}

export function createWebTelemetryAPI(posthogClient: Pick<typeof posthog, 'init' | 'capture'> = posthog): TelemetryAPI {
  // Per-API-instance state: the API is created once per app, and keeping the
  // flags here (not module-level) lets tests build isolated instances.
  let isInitialized = false;
  let hasLoggedMissingKey = false;

  const initIfNeeded = (): boolean => {
    if (isInitialized) return true;
    const { appKey, hostUrl } = getPostHogConfig();

    if (appKey && globalThis.window !== undefined) {
      try {
        posthogClient.init(appKey, {
          api_host: hostUrl,
          ip: false, // ZERO-PII: IP tracking disabled
          persistence: 'localStorage',
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          disable_session_recording: true,
          advanced_disable_decide: true,
        });
        isInitialized = true;
        console.info('[PostHog] Initialized successfully with host:', hostUrl);
        return true;
      } catch (err) {
        console.warn('[PostHog] Failed to initialize:', err);
      }
    } else if (!appKey && !hasLoggedMissingKey && globalThis.window !== undefined) {
      hasLoggedMissingKey = true;
      console.warn('[PostHog] VITE_POSTHOG_APP_KEY is missing from environment.');
    }
    return false;
  };

  // PostHog deliberately initializes lazily inside trackEvent, never at API
  // creation, so nothing is sent or persisted before a consented event arrives.

  return {
    trackEvent(name: string, properties?: Record<string, string | number | boolean>) {
      // SAFETY: Accessing optional desktop bridge attached to globalThis by Electron preload script.
      const desktopWin = globalThis.window as (Window & DesktopBridgeGlobal) | undefined;
      const desktopBridge = desktopWin?.__OPENCHAMBER_DESKTOP__;

      if (desktopBridge?.trackTelemetryEvent) {
        desktopBridge.trackTelemetryEvent(name, properties);
        return;
      }

      if (initIfNeeded()) {
        posthogClient.capture(name, properties);
      }
    },
  };
}
