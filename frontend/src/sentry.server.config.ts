import * as Sentry from "@sentry/nextjs";

import { getSentryRuntimeOptions } from "./lib/observability/sentry-config";

Sentry.init({
  ...getSentryRuntimeOptions(),
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
});
