/**
 * Historical eformsign templates remain visible when listing old documents, but they are
 * not valid inputs for any new template registration or document creation.
 *
 * Keep this policy in a dependency-light utility so list scope, area-template persistence,
 * and provider creation all enforce the same boundary without importing a Nest service.
 */
export const LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS = [
    "d1591da29590495d800f55f1d1fc1378",
    "e63c528b0375478d83e30ff8a9ed1967",
] as const;

const LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_ID_SET = new Set<string>(
    LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS,
);

export function isListOnlyHistoricalMaternityTemplateId(
    templateId: string | null | undefined,
): boolean {
    return typeof templateId === "string"
        && LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_ID_SET.has(templateId);
}

export class EformsignHistoricalTemplateCreationError extends Error {
    constructor() {
        super("This eformsign template is historical list-only and cannot be used for new document creation");
        this.name = "EformsignHistoricalTemplateCreationError";
    }
}

export function assertEformsignTemplateCanBeCreated(
    templateId: string | null | undefined,
): void {
    if (isListOnlyHistoricalMaternityTemplateId(templateId)) {
        throw new EformsignHistoricalTemplateCreationError();
    }
}
