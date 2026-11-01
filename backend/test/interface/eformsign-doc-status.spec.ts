import { BadRequestException } from "@nestjs/common";
import { PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";

import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";
import { CreateEformsignDocLocalDto } from "interface/dto/eformsign-doc.dto";

describe("EformsignDocController local status input", () => {
    const create = jest.fn();
    const controller = new EformsignDocController(
        { create } as never,
        {} as never, {} as never, {} as never, {} as never, {} as never,
        {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    const dto = (statusType: string): CreateEformsignDocLocalDto => ({
        documentId: "local-status-doc", clientId: 1, statusType,
        statusDetail: "완료", stepType: "06", stepIndex: "1", stepName: "확인",
        stepRecipientType: "02", stepRecipientName: "계약자", stepRecipientSms: "01000000000",
        expiredDate: "2099-01-01T00:00:00.000Z",
    });

    beforeEach(() => {
        create.mockReset().mockResolvedValue({ id: 1, toJSON: () => ({ id: 1 }) });
    });

    it.each([
        ["50", "050"], [" DOC_COMPLETE ", "003"], ["060", "060"],
        [" 7 ", "007"], ["999", "999"], ["", "000"],
    ])("stores %s as canonical %s (including unlisted provider codes)", async (input, canonical) => {
        await controller.create({ branchId: "branch" }, dto(input));
        expect(create).toHaveBeenCalledWith("branch", expect.objectContaining({ statusType: canonical }));
    });

    it.each(["unknown_status", "1000", "-50", "5.0", "0a0", "０５０"])("rejects invalid normalized status %s before writing", async (input) => {
        const result = controller.create({ branchId: "branch" }, dto(input));
        await expect(result).rejects.toBeInstanceOf(BadRequestException);
        await expect(result).rejects.toMatchObject({
            response: {
                code: "VALIDATION_FAILED", outcome: "NOT_APPLIED",
                message: PROBLEM_CATALOG.VALIDATION_FAILED.detail["ko-KR"],
            },
        });
        expect(create).not.toHaveBeenCalled();
    });
});
