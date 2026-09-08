import "reflect-metadata";

import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
    ConfirmServiceRecordEditDraftDto,
    CreateServiceRecordEditDraftDto,
    UpdateServiceRecordEditDraftDto,
} from "interface/dto/admin-service-record-edit.dto";

async function validationErrors<T extends object>(type: new () => T, payload: object) {
    return validate(plainToInstance(type, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
    });
}

describe("admin service-record edit DTOs", () => {
    it("accepts date-only draft sessions and the editable header/session fields", async () => {
        const errors = await validationErrors(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 1,
            changes: {
                header: { momName: "산모", babyWeight: "3.2" },
                sessions: [{
                    sessionIndex: 1,
                    serviceDate: "2026-09-08",
                    answers: { perineum: ["이상없음"] },
                    etcService: "안내",
                    notes: "메모",
                    paymentConfirmed: true,
                }],
            },
        });

        expect(errors).toEqual([]);
    });

    it("rejects timestamp dates and authority/lifecycle fields at the DTO boundary", async () => {
        const errors = await validationErrors(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 1,
            changes: {
                branchId: "attacker-branch",
                sessions: [{
                    sessionIndex: 1,
                    serviceDate: "2026-09-08T00:00:00.000Z",
                    clientSignature: "forged",
                }],
            },
        });

        expect(errors.some((error) => error.property === "changes")).toBe(true);
    });

    it("allows an empty start body while still rejecting unknown root properties", async () => {
        await expect(validationErrors(CreateServiceRecordEditDraftDto, {})).resolves.toEqual([]);
        const errors = await validationErrors(CreateServiceRecordEditDraftDto, { actorUserId: "forged" });
        expect(errors.some((error) => error.property === "actorUserId")).toBe(true);
    });

    it("requires the server preview id and UUID idempotency key for confirmation", async () => {
        await expect(validationErrors(ConfirmServiceRecordEditDraftDto, {
            expectedDraftVersion: 2,
            previewId: "srp_" + "a".repeat(64),
            idempotencyKey: "11111111-1111-4111-8111-111111111111",
        })).resolves.toEqual([]);

        const errors = await validationErrors(ConfirmServiceRecordEditDraftDto, {
            expectedDraftVersion: 2,
            previewId: "preview-from-client",
            idempotencyKey: "not-a-uuid",
        });
        expect(errors.some((error) => error.property === "previewId")).toBe(true);
        expect(errors.some((error) => error.property === "idempotencyKey")).toBe(true);
    });
});
