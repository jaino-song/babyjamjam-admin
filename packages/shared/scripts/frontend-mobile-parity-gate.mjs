#!/usr/bin/env node

/**
 * Source-ownership gate for the frontend/mobile behaviour parity contract.
 *
 * The shared package owns business vocabulary and behaviour.  The app
 * workspaces may keep feature-local import paths, but those files must remain
 * adapters (or presentation-only policy) rather than becoming a second
 * implementation.  This gate intentionally checks declarations and imports,
 * not every occurrence of a template key: a one-key routing guard such as
 * `templateKey === "SERVICE_END_NOTICE"` is valid and must not be rejected.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(scriptPath), "../../..");

export const SHARED_OWNED_SEAMS = Object.freeze([
  "packages/shared/src/types/message.ts",
  "packages/shared/src/types/system-template.ts",
  "packages/shared/src/api/route-utils.ts",
  "packages/shared/src/constants/eformsign-status-codes.ts",
  "packages/shared/src/client/voucher-duration.ts",
  "packages/shared/src/utils/phone.ts",
  "packages/shared/src/utils/korean-search.ts",
  "packages/shared/src/template/utils.ts",
]);

export const THIN_ADAPTERS = Object.freeze([
  "frontend/src/lib/phone.ts",
  "mobile/src/lib/phone.ts",
  "frontend/src/lib/search/korean-search.ts",
  "mobile/src/lib/search/korean-search.ts",
  "frontend/src/lib/voucher/duration.ts",
  "mobile/src/lib/voucher/duration.ts",
  "frontend/src/lib/template/variable-parser.ts",
  "mobile/src/lib/template/variable-parser.ts",
]);

export const EFORMSIGN_ADAPTERS = Object.freeze([
  "frontend/src/lib/eformsign/status-codes.ts",
  "mobile/src/lib/eformsign/status-codes.ts",
]);

export const MESSAGE_TRIGGER_BFF_ROUTES = Object.freeze([
  Object.freeze({
    path: "frontend/src/app/api/message-trigger-rules/route.ts",
    schema: "createMessageTriggerRuleSchema",
  }),
  Object.freeze({
    path: "frontend/src/app/api/message-trigger-rules/[triggerId]/route.ts",
    schema: "updateMessageTriggerRuleSchema",
  }),
  Object.freeze({
    path: "mobile/src/app/api/message-trigger-rules/route.ts",
    schema: "createMessageTriggerRuleSchema",
  }),
  Object.freeze({
    path: "mobile/src/app/api/message-trigger-rules/[triggerId]/route.ts",
    schema: "updateMessageTriggerRuleSchema",
  }),
]);

export const SYSTEM_TEMPLATE_BFF_ROUTES = Object.freeze([
  Object.freeze({
    path: "frontend/src/app/api/system-templates/[key]/route.ts",
    schema: "updateSystemTemplateSchema",
  }),
  Object.freeze({
    path: "frontend/src/app/api/system-templates/[key]/validate/route.ts",
    schema: "validateSystemTemplateSchema",
  }),
  Object.freeze({
    path: "frontend/src/app/api/system-templates/[key]/preview/route.ts",
    schema: "previewSystemTemplateSchema",
  }),
  Object.freeze({
    path: "mobile/src/app/api/system-templates/[key]/route.ts",
    schema: "updateSystemTemplateSchema",
  }),
  Object.freeze({
    path: "mobile/src/app/api/system-templates/[key]/validate/route.ts",
    schema: "validateSystemTemplateSchema",
  }),
  Object.freeze({
    path: "mobile/src/app/api/system-templates/[key]/preview/route.ts",
    schema: "previewSystemTemplateSchema",
  }),
]);

export const SYSTEM_TEMPLATE_ROUTE_HELPERS = Object.freeze([
  "frontend/src/lib/api/system-template-routes.ts",
  "mobile/src/lib/api/system-template-routes.ts",
]);

export const CANONICAL_HELPERS = Object.freeze([
  "formatKoreanPhoneNumber",
  "isValidKoreanPhoneNumber",
  "normalizeKoreanPhoneDigits",
  "normalizeKoreanPhoneForLookup",
  "normalizeKoreanPhoneLookupKey",
  "normalizePhoneDigits",
  "getChosung",
  "getChosungString",
  "isChosung",
  "isPhoneLikeSearchQuery",
  "matchesKoreanSearch",
  "matchesSearchQuery",
  "matchesSearchValues",
  "inferVoucherDuration",
  "inferVoucherDurationFromAmounts",
  "extractVariables",
  "getUnresolvedKeys",
  "renderTemplate",
  "normalizeEformsignStatusCode",
  "getEformsignStatusCategory",
  "getEformsignStatusLabel",
  "isDeletedEformsignStatusCode",
]);

/**
 * These are deliberate policy surfaces, not owners of the shared key list.
 * Keep this list small and named: adding a new exception requires a reason in
 * the companion spec and a review of whether it can be data-driven instead.
 */
export const INTENTIONAL_EXCEPTIONS = Object.freeze([
  Object.freeze({
    path: "mobile/src/app/(shell)/messages/new/page.tsx",
    rule: "template-key-comparison-and-rollout",
    reason: "Mobile exposes a staged manual-send subset and has an explicit receipt-link fail-closed guard.",
  }),
  Object.freeze({
    path: "frontend/src/features/system-templates/catalog.ts",
    rule: "legacy-template-route-compatibility",
    reason: "The frontend preserves historical deep-link ids while the server catalog remains authoritative.",
  }),
  Object.freeze({
    path: "frontend/src/app/(protected)/messages/page.tsx",
    rule: "presentation-icon-routing",
    reason: "The icon map and single-key delivery guard are presentation routing; the key set comes from shared data.",
  }),
  Object.freeze({
    path: "frontend/src/components/app/messages/TriggerRulesManager.tsx",
    rule: "legacy-fallback-copy",
    reason: "Existing fallback message copy is a UI fallback for an unavailable catalog, not a trigger contract owner.",
  }),
  Object.freeze({
    path: "frontend/src/lib/client/client-registration-formats.ts",
    rule: "client-form-display-format",
    reason: "Client-registration formatting preserves that form's compact-input contract; lookup and identity normalization stay shared.",
  }),
  Object.freeze({
    path: "mobile/src/app/(shell)/clients/new/page.tsx",
    rule: "contract-prefill-identity",
    reason: "The contract-prefill flow compares an optional phone snapshot while matching a name; it does not define the stored/search phone contract.",
  }),
  Object.freeze({
    path: "frontend/src/app/api/message-logs/[id]/retry/route.ts",
    rule: "frontend-retry",
    reason: "Retry is a frontend-only operator capability and is intentionally absent from mobile.",
  }),
  Object.freeze({
    path: "frontend/src/app/(protected)",
    rule: "root-navigation",
    reason: "Frontend settings/messages navigation is platform-specific.",
  }),
  Object.freeze({
    path: "mobile/src/app/api/receipt/[token]",
    rule: "mobile-public-token-routes",
    reason: "Public token routes are a mobile-only disclosure surface.",
  }),
  Object.freeze({
    path: "frontend/src/lib/api",
    rule: "platform-auth-refresh-and-base-url",
    reason: "Browser cookie refresh and frontend base URL policy intentionally differ from mobile transport policy.",
  }),
  Object.freeze({
    path: "mobile/src/lib/api",
    rule: "platform-auth-refresh-and-base-url",
    reason: "Mobile token refresh and native base URL policy intentionally differ from frontend transport policy.",
  }),
]);

const APP_SOURCE_ROOTS = Object.freeze(["frontend/src", "mobile/src"]);
const TEST_OR_FIXTURE_PATH = /(?:^|\/)(?:__tests__|mocks|fixtures)(?:\/|$)|\.(?:test|spec)\.(?:ts|tsx)$/;

function normalizeRelativePath(value) {
  return value.split(path.sep).join("/");
}

function sourceText(sources, relativePath) {
  if (sources instanceof Map) return sources.get(relativePath);
  return sources?.[relativePath];
}

function sourceEntries(sources) {
  if (sources instanceof Map) return [...sources.entries()];
  return Object.entries(sources ?? {});
}

function isTestOrFixturePath(relativePath) {
  return TEST_OR_FIXTURE_PATH.test(relativePath);
}

function isIntentionalException(relativePath, rule) {
  return INTENTIONAL_EXCEPTIONS.some((entry) => {
    if (entry.rule !== rule) return false;
    return relativePath === entry.path || relativePath.startsWith(`${entry.path}/`);
  });
}

function collectSources(directory, repoRoot, sources) {
  if (!existsSync(directory)) return;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSources(absolutePath, repoRoot, sources);
      continue;
    }

    if (!/\.(?:ts|tsx)$/.test(entry.name)) continue;
    const relativePath = normalizeRelativePath(absolutePath.slice(repoRoot.length + 1));
    if (isTestOrFixturePath(relativePath)) continue;
    sources.set(relativePath, readFileSync(absolutePath, "utf8"));
  }
}

export function readRepositorySources(repoRoot = defaultRepoRoot) {
  const sources = new Map();
  for (const sourceRoot of [...APP_SOURCE_ROOTS, "packages/shared/src"]) {
    collectSources(path.join(repoRoot, sourceRoot), repoRoot, sources);
  }
  return sources;
}

function hasSharedImport(source, packagePath) {
  const importPath = packagePath ? `@babyjamjam/shared/${packagePath}` : "@babyjamjam/shared";
  return source.includes(importPath);
}

function declarationPattern(name) {
  return new RegExp(
    String.raw`(?:^|[;\n])\s*(?:export\s+)?(?:async\s+)?function\s+${name}\b|(?:^|[;\n])\s*(?:export\s+)?(?:const|let|var)\s+${name}\s*=`,
    "m",
  );
}

function findLocalHelperDeclarations(source, relativePath) {
  const declarations = [];
  for (const helper of CANONICAL_HELPERS) {
    if (!declarationPattern(helper).test(source)) continue;
    if (
      relativePath === "frontend/src/lib/client/client-registration-formats.ts" &&
      helper === "formatKoreanPhoneNumber"
    ) {
      continue;
    }
    declarations.push(helper);
  }
  return declarations;
}

function validateSharedSeams(sources) {
  const errors = [];
  for (const seam of SHARED_OWNED_SEAMS) {
    const source = sourceText(sources, seam);
    if (typeof source !== "string") {
      errors.push(`Missing shared ownership seam ${seam}.`);
    }
  }
  return errors;
}

function validateThinAdapters(sources) {
  const errors = [];
  for (const adapter of THIN_ADAPTERS) {
    const source = sourceText(sources, adapter);
    if (typeof source !== "string") {
      errors.push(`Missing shared adapter ${adapter}.`);
      continue;
    }

    if (!hasSharedImport(source, "")) {
      errors.push(`${adapter} must import its behaviour from @babyjamjam/shared.`);
    }

    const localHelpers = findLocalHelperDeclarations(source, adapter);
    if (localHelpers.length > 0) {
      errors.push(`${adapter} contains local shared-helper implementation(s): ${localHelpers.join(", ")}.`);
    }
  }
  return errors;
}

function validateEformsignAdapters(sources) {
  const errors = [];
  for (const adapter of EFORMSIGN_ADAPTERS) {
    const source = sourceText(sources, adapter);
    if (typeof source !== "string") {
      errors.push(`Missing eformsign status adapter ${adapter}.`);
      continue;
    }

    if (!hasSharedImport(source, "constants/eformsign-status-codes")) {
      errors.push(`${adapter} must consume @babyjamjam/shared/constants/eformsign-status-codes.`);
    }

    const localHelpers = findLocalHelperDeclarations(source, adapter);
    if (localHelpers.length > 0) {
      errors.push(`${adapter} contains local eformsign implementation(s): ${localHelpers.join(", ")}.`);
    }

    const localCodeSet = /\b(?:COMPLETED|EXPIRED|IN_PROGRESS|DELETED)(?:_STATUS)?_CODES\s*=\s*(?:new\s+Set\s*\(\s*)?\[/;
    if (localCodeSet.test(source)) {
      errors.push(`${adapter} must derive eformsign status-code sets from the shared constants.`);
    }
  }
  return errors;
}

function isOwnershipSensitivePath(relativePath) {
  return (
    /\/features\/(?:message-triggers|message-templates|system-templates)\//.test(relativePath) ||
    /\/lib\/(?:template|voucher|search|eformsign|phone)\//.test(relativePath) ||
    /\/app\/api\/message-trigger-rules\//.test(relativePath) ||
    relativePath.endsWith("/app/api/message-trigger-rules/route.ts")
  );
}

function sharedTemplateKeys(sources) {
  const keys = new Set();
  const sharedSources = [
    sourceText(sources, "packages/shared/src/types/message.ts"),
    sourceText(sources, "packages/shared/src/types/system-template.ts"),
  ];
  const declarationPattern = /(?:SYSTEM_TEMPLATE_KEYS|MESSAGE_TRIGGER_TEMPLATE_KEYS)\s*=\s*\[([\s\S]*?)\]/g;
  const literalPattern = /["']([A-Z][A-Z0-9_]{2,})["']/g;

  for (const source of sharedSources) {
    if (typeof source !== "string") continue;
    for (const declaration of source.matchAll(declarationPattern)) {
      for (const literal of declaration[1].matchAll(literalPattern)) keys.add(literal[1]);
    }
  }

  return keys;
}

function countCanonicalKeyLiterals(source, canonicalKeys) {
  const literals = new Set();
  const literalPattern = /["']([A-Z][A-Z0-9_]{2,})["']/g;
  for (const match of source.matchAll(literalPattern)) {
    if (canonicalKeys.has(match[1])) literals.add(match[1]);
  }
  return literals;
}

function validateLocalTemplateKeyDeclarations(sources) {
  const errors = [];
  const canonicalKeys = sharedTemplateKeys(sources);
  const listDeclarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:(?:new\s+Set)\s*\(\s*)?\[/g;
  const unionDeclarationPattern = /\b(?:type|enum)\s+([A-Za-z_$][\w$]*(?:Template|Trigger|System)[A-Za-z_$\d]*Key[A-Za-z_$\d]*)\b/g;

  for (const [relativePath, source] of sourceEntries(sources)) {
    if (!isOwnershipSensitivePath(relativePath) || isTestOrFixturePath(relativePath)) continue;

    for (const match of source.matchAll(listDeclarationPattern)) {
      const name = match[1];
      if (!/(?:template|trigger|system).*keys?|keys?.*(?:template|trigger|system)/i.test(name)) continue;
      if (
        relativePath === "frontend/src/features/system-templates/catalog.ts" &&
        name === "RETIRED_MANUAL_TEMPLATE_KEYS"
      ) {
        continue;
      }
      const declarationStart = match.index ?? 0;
      const tail = source.slice(declarationStart, declarationStart + 5000);
      const keys = countCanonicalKeyLiterals(tail, canonicalKeys);
      if (keys.size === 0) continue;
      errors.push(`${relativePath} declares local template/trigger key list ${name}; import the shared list instead.`);
    }

    for (const match of source.matchAll(unionDeclarationPattern)) {
      const declarationStart = match.index ?? 0;
      const declarationEnd = source.indexOf(";", declarationStart);
      const tail = source.slice(
        declarationStart,
        declarationEnd >= 0 ? declarationEnd + 1 : declarationStart + 2000,
      );
      const keys = countCanonicalKeyLiterals(tail, canonicalKeys);
      if (keys.size === 0 && !/\b(?:enum)\b/.test(match[0])) continue;
      errors.push(`${relativePath} declares local template/trigger key type ${match[1]}; use the shared key type.`);
    }
  }

  return errors;
}

function validateTemplateKeyMaps(sources) {
  const errors = [];
  const canonicalKeys = sharedTemplateKeys(sources);
  const mapDeclarationPattern = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*{([\s\S]*?)\n};/g;
  const propertyPattern = /^\s*([A-Z][A-Z0-9_]{2,})\s*:/gm;
  const allowedPaths = new Set([
    "frontend/src/features/system-templates/catalog.ts",
    "frontend/src/app/(protected)/messages/page.tsx",
    "frontend/src/components/app/messages/TriggerRulesManager.tsx",
  ]);

  for (const [relativePath, source] of sourceEntries(sources)) {
    if (!allowedPaths.has(relativePath) || isTestOrFixturePath(relativePath)) continue;

    for (const match of source.matchAll(mapDeclarationPattern)) {
      const name = match[1];
      if (!/(?:template|trigger|system).*key|key.*(?:template|trigger|system)/i.test(name)) continue;

      for (const property of match[2].matchAll(propertyPattern)) {
        if (!canonicalKeys.has(property[1])) {
          errors.push(`${relativePath} declares local template/trigger key ${property[1]} in ${name}; use the shared catalog.`);
        }
      }
    }
  }

  return errors;
}

function validateNoLocalSharedImplementations(sources) {
  const errors = [];
  for (const [relativePath, source] of sourceEntries(sources)) {
    if (!relativePath.startsWith("frontend/src/") && !relativePath.startsWith("mobile/src/")) continue;
    if (isTestOrFixturePath(relativePath)) continue;

    if (isIntentionalException(relativePath, "contract-prefill-identity")) continue;

    const localHelpers = findLocalHelperDeclarations(source, relativePath);
    if (localHelpers.length === 0) continue;

    for (const helper of localHelpers) {
      errors.push(`${relativePath} declares shared-owned helper ${helper}; re-export or call the shared implementation.`);
    }
  }
  return errors;
}

function validateMessageTriggerBffs(sources) {
  const errors = [];
  for (const route of MESSAGE_TRIGGER_BFF_ROUTES) {
    const source = sourceText(sources, route.path);
    if (typeof source !== "string") {
      errors.push(`Missing message-trigger BFF route ${route.path}.`);
      continue;
    }

    if (!source.includes(route.schema)) {
      errors.push(`${route.path} must parse input with shared ${route.schema}.`);
    }
    if (!hasSharedImport(source, "types/message")) {
      errors.push(`${route.path} must import ${route.schema} from @babyjamjam/shared/types/message.`);
    }
    if (!source.includes("messageTriggerUpstreamErrorResponse")) {
      errors.push(`${route.path} must use shared messageTriggerUpstreamErrorResponse policy.`);
    }

    const importsSharedApi = hasSharedImport(source, "api");
    const importsMobileApiAdapter = source.includes('from "@/lib/api/route-utils"') || source.includes("from '@/lib/api/route-utils'");
    if (!importsSharedApi && !importsMobileApiAdapter) {
      errors.push(`${route.path} must import shared route utilities directly or through the mobile shared adapter.`);
    }
  }

  const mobileRouteUtils = sourceText(sources, "mobile/src/lib/api/route-utils.ts");
  if (typeof mobileRouteUtils === "string") {
    if (!hasSharedImport(mobileRouteUtils, "api") || !mobileRouteUtils.includes("messageTriggerUpstreamErrorResponse")) {
      errors.push("mobile/src/lib/api/route-utils.ts must re-export shared message-trigger route policy.");
    }
  }

  return errors;
}

function validateSystemTemplateBffs(sources) {
  const errors = [];
  for (const route of SYSTEM_TEMPLATE_BFF_ROUTES) {
    const source = sourceText(sources, route.path);
    if (typeof source !== "string") {
      errors.push(`Missing system-template BFF route ${route.path}.`);
      continue;
    }

    if (!source.includes(route.schema)) {
      errors.push(`${route.path} must parse input with shared ${route.schema}.`);
    }
    if (!hasSharedImport(source, "types/system-template")) {
      errors.push(`${route.path} must import ${route.schema} from @babyjamjam/shared/types/system-template.`);
    }
  }

  for (const helper of SYSTEM_TEMPLATE_ROUTE_HELPERS) {
    const source = sourceText(sources, helper);
    if (typeof source !== "string") {
      errors.push(`Missing system-template route helper ${helper}.`);
      continue;
    }

    if (!source.includes("buildSystemTemplatePath")) {
      errors.push(`${helper} must use shared buildSystemTemplatePath for encoded key segments.`);
    }
    if (!source.includes("systemTemplateBackendJsonResponse")) {
      errors.push(`${helper} must use shared systemTemplateBackendJsonResponse policy.`);
    }
    if (!source.includes("systemTemplateUpstreamErrorResponse")) {
      errors.push(`${helper} must use shared systemTemplateUpstreamErrorResponse policy.`);
    }
    if (!source.includes('from "@/lib/api/route-utils"')) {
      errors.push(`${helper} must consume the platform route-utils adapter for shared system-template policy.`);
    }
  }

  return errors;
}

export function validateFrontendMobileParity({ sources }) {
  const errors = [
    ...validateSharedSeams(sources),
    ...validateThinAdapters(sources),
    ...validateEformsignAdapters(sources),
    ...validateLocalTemplateKeyDeclarations(sources),
    ...validateTemplateKeyMaps(sources),
    ...validateNoLocalSharedImplementations(sources),
    ...validateMessageTriggerBffs(sources),
    ...validateSystemTemplateBffs(sources),
  ];
  return [...new Set(errors)];
}

export const validateParitySources = validateFrontendMobileParity;

export function runParityGate(repoRoot = defaultRepoRoot) {
  const errors = validateFrontendMobileParity({ sources: readRepositorySources(repoRoot) });
  if (errors.length > 0) {
    throw new Error(`Frontend-mobile parity ownership gate failed:\n- ${errors.join("\n- ")}`);
  }
}

if (path.resolve(process.argv[1] ?? "") === scriptPath) {
  try {
    runParityGate();
    console.log("Frontend-mobile parity ownership gate passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
