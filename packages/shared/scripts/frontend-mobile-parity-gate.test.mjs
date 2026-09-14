import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  readRepositorySources,
  validateFrontendMobileParity,
} from "./frontend-mobile-parity-gate.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const sources = readRepositorySources(repoRoot);

function withSource(relativePath, mutate) {
  const next = new Map(sources);
  const current = next.get(relativePath);
  assert.equal(typeof current, "string", `fixture source is missing: ${relativePath}`);
  next.set(relativePath, mutate(current));
  return next;
}

test("accepts the current shared adapters, trigger BFFs, and intentional policy comparisons", () => {
  assert.deepEqual(validateFrontendMobileParity({ sources }), []);

  const sourcesWithSingleKeyGuard = withSource(
    "mobile/src/app/(shell)/messages/new/page.tsx",
    (source) => `${source}\nfunction deliveryGuard(templateKey) { return templateKey === "SERVICE_END_NOTICE"; }\n`,
  );

  assert.deepEqual(validateFrontendMobileParity({ sources: sourcesWithSingleKeyGuard }), []);
});

test("rejects a local trigger template key list mutation", () => {
  const mutatedSources = withSource(
    "frontend/src/features/message-triggers/types.ts",
    (source) => `${source}\nconst LOCAL_TRIGGER_TEMPLATE_KEYS = ["SERVICE_INFO", "SERVICE_END_NOTICE"];\n`,
  );

  const errors = validateFrontendMobileParity({ sources: mutatedSources });
  assert.ok(
    errors.some((error) =>
      error.includes("declares local template/trigger key list LOCAL_TRIGGER_TEMPLATE_KEYS"),
    ),
  );
});

test("rejects a new key added to an existing frontend compatibility map", () => {
  const mutatedSources = withSource(
    "frontend/src/features/system-templates/catalog.ts",
    (source) => source.replace(
      '  SERVICE_END_NOTICE: "service-end-notice",',
      '  SERVICE_END_NOTICE: "service-end-notice",\n  NEW_LOCAL_TEMPLATE: "new-local-template",',
    ),
  );

  const errors = validateFrontendMobileParity({ sources: mutatedSources });
  assert.ok(
    errors.some((error) =>
      error.includes("declares local template/trigger key NEW_LOCAL_TEMPLATE"),
    ),
  );
});

test("rejects a duplicate voucher helper implementation", () => {
  const mutatedSources = withSource(
    "mobile/src/lib/voucher/duration.ts",
    (source) => `${source}\nexport function inferVoucherDurationFromAmounts() { return null; }\n`,
  );

  const errors = validateFrontendMobileParity({ sources: mutatedSources });
  assert.ok(
    errors.some((error) =>
      error.includes("mobile/src/lib/voucher/duration.ts contains local shared-helper implementation(s): inferVoucherDurationFromAmounts"),
    ),
  );
  assert.ok(
    errors.some((error) =>
      error.includes("declares shared-owned helper inferVoucherDurationFromAmounts"),
    ),
  );
});

test("rejects an eformsign status-code set copied into an app adapter", () => {
  const mutatedSources = withSource(
    "frontend/src/lib/eformsign/status-codes.ts",
    (source) => `${source}\nconst EXPIRED_STATUS_CODES = ["047", "049"];\n`,
  );

  const errors = validateFrontendMobileParity({ sources: mutatedSources });
  assert.ok(
    errors.some((error) =>
      error.includes("must derive eformsign status-code sets from the shared constants"),
    ),
  );
});

test("rejects a message trigger BFF that stops using the shared schema", () => {
  const mutatedSources = withSource(
    "mobile/src/app/api/message-trigger-rules/route.ts",
    (source) => source.replaceAll("createMessageTriggerRuleSchema", "localTriggerSchema"),
  );

  const errors = validateFrontendMobileParity({ sources: mutatedSources });
  assert.ok(
    errors.some((error) =>
      error.includes("mobile/src/app/api/message-trigger-rules/route.ts must parse input with shared createMessageTriggerRuleSchema"),
    ),
  );
});

test("rejects a message trigger BFF that aliases a local schema", () => {
  const mutatedSources = withSource(
    "frontend/src/app/api/message-trigger-rules/route.ts",
    (source) => source.replace('from "@babyjamjam/shared/types/message"', 'from "@/lib/local-message-schema"'),
  );

  const errors = validateFrontendMobileParity({ sources: mutatedSources });
  assert.ok(
    errors.some((error) =>
      error.includes("frontend/src/app/api/message-trigger-rules/route.ts must import createMessageTriggerRuleSchema from @babyjamjam/shared/types/message"),
    ),
  );
});
