import * as Sentry from "@sentry/nextjs";

import {
  getReplayErrorSampleRate,
  getReplaySessionSampleRate,
  getSentryRuntimeOptions,
} from "./lib/observability/sentry-config";

Sentry.init({
  ...getSentryRuntimeOptions(),
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  replaysSessionSampleRate: getReplaySessionSampleRate(),
  replaysOnErrorSampleRate: getReplayErrorSampleRate(),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
