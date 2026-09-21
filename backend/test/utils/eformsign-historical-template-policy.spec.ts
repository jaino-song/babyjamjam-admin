import {
    assertEformsignTemplateCanBeCreated,
    EformsignHistoricalTemplateCreationError,
    isListOnlyHistoricalMaternityTemplateId,
    LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS,
} from "application/utils/eformsign-historical-template-policy";

describe("eformsign historical-template policy", () => {
    it.each(LIST_ONLY_HISTORICAL_MATERNITY_TEMPLATE_IDS)(
        "keeps %s list-visible but rejects it for creation",
        (templateId) => {
            expect(isListOnlyHistoricalMaternityTemplateId(templateId)).toBe(true);
            expect(() => assertEformsignTemplateCanBeCreated(templateId)).toThrow(
                EformsignHistoricalTemplateCreationError,
            );
        },
    );

    it.each(["active-template", "", null, undefined])(
        "allows non-retired template input %j",
        (templateId) => {
            expect(isListOnlyHistoricalMaternityTemplateId(templateId)).toBe(false);
            expect(() => assertEformsignTemplateCanBeCreated(templateId)).not.toThrow();
        },
    );
});
