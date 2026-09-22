import { BadRequestException } from "@nestjs/common";

import {
    SystemTemplateMutationGuardService,
    validateSystemTemplateCandidate,
} from "application/services/system-template-mutation-guard.service";
import { SystemTemplateKey } from "domain/constants/system-template-registry";

describe("SystemTemplateMutationGuardService problem contract", () => {
    const createGuard = (activeTemplateKeys: string[] = []) => {
        const messageTriggerRuleRepository = {
            findActiveTemplateKeys: jest.fn().mockResolvedValue(activeTemplateKeys),
        };
        const guard = new SystemTemplateMutationGuardService(messageTriggerRuleRepository as never);
        return { guard, messageTriggerRuleRepository };
    };

    it("rejects invalid template content with a VALIDATION_FAILED problem body naming the content pointer", async () => {
        const { guard, messageTriggerRuleRepository } = createGuard();

        const promise = guard.assertValid(
            SystemTemplateKey.GREETING,
            "{{unknownVar}} 님 안녕하세요",
            [],
        );

        await expect(promise).rejects.toBeInstanceOf(BadRequestException);
        await expect(promise).rejects.toMatchObject({
            status: 400,
            response: expect.objectContaining({
                code: "VALIDATION_FAILED",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
                errors: expect.arrayContaining([
                    expect.objectContaining({ pointer: "/content" }),
                ]),
            }),
        });
        const cause = await promise.catch((error: unknown) => error);
        const body = (cause as { response: { errors: Array<{ pointer: string; detail: string }> } }).response;
        expect(body.errors).toEqual([
            { pointer: "/content", code: "INVALID_VALUE", detail: "정의되지 않은 변수: {{unknownVar}}" },
        ]);
        expect(messageTriggerRuleRepository.findActiveTemplateKeys).not.toHaveBeenCalled();
    });

    it("rejects edits breaking an active automation rule with VALIDATION_FAILED and per-variable pointers", async () => {
        const { guard } = createGuard([SystemTemplateKey.SERVICE_INFO]);

        await expect(guard.assertValid(
            SystemTemplateKey.SERVICE_INFO,
            "{{name}} 예약 번호: {{reservationCode}}",
            [{ key: "reservationCode", label: "예약 코드", required: true }],
        )).rejects.toMatchObject({
            status: 400,
            response: expect.objectContaining({
                code: "VALIDATION_FAILED",
                outcome: "NOT_APPLIED",
                recovery: { action: "NONE", retry: { mode: "NEVER" } },
                errors: [expect.objectContaining({
                    pointer: "/customVariables/reservationCode",
                })],
                unsupportedVariables: ["reservationCode"],
            }),
        });
    });

    it("passes valid candidates through without touching the rule repository", async () => {
        const { guard, messageTriggerRuleRepository } = createGuard();

        await expect(guard.assertValid(SystemTemplateKey.GREETING, "안녕하세요", [])).resolves.toBeUndefined();
        expect(messageTriggerRuleRepository.findActiveTemplateKeys).not.toHaveBeenCalled();
    });

    it("keeps the candidate validator reporting missing, unknown and syntax problems", () => {
        const validation = validateSystemTemplateCandidate(
            SystemTemplateKey.SERVICE_INFO,
            "{{missingVar}} {{openVar",
            [],
        );

        expect(validation.valid).toBe(false);
        expect(validation.syntaxErrors.length).toBeGreaterThan(0);
    });
});
