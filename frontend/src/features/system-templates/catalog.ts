import type {
  CustomVariable,
  SystemTemplate,
  TemplateVariable,
} from "./types";

/**
 * The server registry is the source of truth for the template list. The
 * frontend keeps this compatibility map only for the eight legacy ids that
 * are already used by the messages page and existing links.
 */
export const LEGACY_SYSTEM_TEMPLATE_IDS = {
  GREETING: "builtin:greeting",
  SERVICE_INFO: "builtin:service-info",
  SERVICE_RECORD_LINK: "builtin:service-feedback-link",
  PRICE_INFO: "builtin:price-info",
  REMINDER: "builtin:reminder",
  THANKS: "builtin:thanks",
  SURVEY: "builtin:survey",
  INFO: "builtin:info",
} as const;

export type LegacySystemTemplateKey = keyof typeof LEGACY_SYSTEM_TEMPLATE_IDS;

export type LegacyBuiltinTemplateType =
  | "greeting"
  | "service-info"
  | "service-feedback-link"
  | "price-info"
  | "reminder"
  | "thanks"
  | "survey"
  | "info";

const LEGACY_BUILTIN_TYPE_BY_KEY: Readonly<Record<LegacySystemTemplateKey, LegacyBuiltinTemplateType>> = {
  GREETING: "greeting",
  SERVICE_INFO: "service-info",
  SERVICE_RECORD_LINK: "service-feedback-link",
  PRICE_INFO: "price-info",
  REMINDER: "reminder",
  THANKS: "thanks",
  SURVEY: "survey",
  INFO: "info",
};

const LEGACY_ID_BY_KEY = new Map<string, string>(Object.entries(LEGACY_SYSTEM_TEMPLATE_IDS));

/**
 * `useSystemTemplates` currently exposes the shared type, whose key union is
 * intentionally narrower than the backend registry. Keeping the wire record
 * key as a string here lets new registry entries flow through without a
 * shared-package change or a membership allowlist.
 */
export type ServerSystemTemplate = Omit<SystemTemplate, "templateKey"> & {
  templateKey: string;
};

export type SystemTemplateManualSendAvailability = "available" | "disabled";

export interface SystemTemplateCatalogItem {
  id: string;
  templateKey: string;
  label: string;
  description: string;
  content: string;
  customVariables: readonly CustomVariable[];
  requiredVariables: readonly TemplateVariable[];
  /** The complete server record is retained for detail/edit rendering. */
  template: ServerSystemTemplate;
  legacyType: LegacyBuiltinTemplateType | null;
  /** Only legacy form flows are known to safely prepare a manual send. */
  manualSendAvailability: SystemTemplateManualSendAvailability;
}

function getStableItemId(templateKey: string, index: number, seenIds: Set<string>) {
  const baseId = LEGACY_ID_BY_KEY.get(templateKey) ?? `builtin:system:${encodeURIComponent(templateKey)}`;
  let itemId = baseId;

  while (seenIds.has(itemId)) {
    itemId = `${baseId}:${index}`;
  }

  seenIds.add(itemId);
  return itemId;
}

function normalizeTemplate(template: ServerSystemTemplate): ServerSystemTemplate | null {
  if (!template || typeof template !== "object") return null;

  const templateKey = typeof template.templateKey === "string" ? template.templateKey.trim() : "";
  if (!templateKey) return null;

  return {
    ...template,
    templateKey,
    name: typeof template.name === "string" ? template.name.trim() : "",
    description: typeof template.description === "string" ? template.description : "",
    content: typeof template.content === "string" ? template.content : "",
    customVariables: Array.isArray(template.customVariables) ? template.customVariables : [],
    requiredVariables: Array.isArray(template.requiredVariables) ? template.requiredVariables : [],
  };
}

/**
 * Build the list directly from the successful server response.
 *
 * An empty, loading, or failed response produces an empty list. In
 * particular, this function never fills the list from the legacy map; that
 * map only gives known server records their historical ids and form routing.
 */
export function buildSystemTemplateCatalog(
  templates: readonly ServerSystemTemplate[] | null | undefined,
): SystemTemplateCatalogItem[] {
  if (!Array.isArray(templates)) return [];

  const seenIds = new Set<string>();

  return templates.flatMap((rawTemplate, index) => {
    const template = normalizeTemplate(rawTemplate);
    if (!template) return [];

    const { templateKey } = template;
    const legacyType =
      Object.prototype.hasOwnProperty.call(LEGACY_BUILTIN_TYPE_BY_KEY, templateKey)
        ? LEGACY_BUILTIN_TYPE_BY_KEY[templateKey as LegacySystemTemplateKey]
        : null;

    return [
      {
        id: getStableItemId(templateKey, index, seenIds),
        templateKey,
        // The API title is authoritative. A malformed blank title still gets
        // a deterministic key label instead of a hardcoded catalog fallback.
        label: template.name || templateKey,
        description: template.description,
        content: template.content,
        customVariables: template.customVariables,
        requiredVariables: template.requiredVariables,
        template,
        legacyType,
        manualSendAvailability: legacyType ? "available" : "disabled",
      },
    ];
  });
}
