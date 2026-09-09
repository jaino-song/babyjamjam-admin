import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import {
    CreateServiceRecordEditDraftDto,
    ServiceRecordEditChangesDto,
    UpdateServiceRecordEditDraftDto,
} from "./admin-service-record-edit.dto";

async function validateStrict<T extends object>(type: new () => T, value: unknown) {
    return validate(plainToInstance(type, value), {
        whitelist: true,
        forbidNonWhitelisted: true,
        forbidUnknownValues: true,
    });
}

describe("admin service-record edit DTO", () => {
    it("accepts only editable header/session fields", async () => {
        const errors = await validateStrict(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 1,
            changes: {
                header: { momName: "엄마", deliveryType: "vaginal" },
                sessions: [{
                    sessionIndex: 1,
                    serviceDate: "2026-09-08",
                    answers: { temperature_temp: "36.5" },
                    etcService: "수유 지도",
                    notes: "정상",
                    paymentConfirmed: false,
                }],
            },
        });
        expect(errors).toHaveLength(0);
    });

    it("accepts one typed dateMove command alongside a draft patch", async () => {
        const errors = await validateStrict(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 2,
            changes: { sessions: [{ sessionIndex: 3, notes: "변경" }] },
            dateMove: { sessionIndex: 3, toDate: "2026-09-11" },
        });
        expect(errors).toHaveLength(0);
    });

    it.each([
        "branchId",
        "actorUserId",
        "sourceCaseVersion",
        "sourceFingerprint",
        "sourceSnapshot",
        "submittedAt",
        "clientSignature",
        "clientSignedAt",
        "employeeId",
        "assignmentId",
    ])("rejects %s as a mutable input", async (forbiddenField) => {
        const errors = await validateStrict(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 1,
            changes: {
                sessions: [{ sessionIndex: 1, notes: "safe", [forbiddenField]: "forged" }],
            },
            [forbiddenField]: "forged",
        });
        expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects forbidden fields nested under the draft changes object", async () => {
        const errors = await validateStrict(ServiceRecordEditChangesDto, {
            header: {
                momName: "엄마",
                signedAt: "2026-09-08T00:00:00.000Z",
            },
            sessions: [{
                sessionIndex: 1,
                notes: "safe",
                submittedAt: "2026-09-08T00:00:00.000Z",
                employeeId: 10,
            }],
        });
        expect(errors.length).toBeGreaterThan(0);
    });

    it("rejects authority fields nested under dateMove", async () => {
        const errors = await validateStrict(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 1,
            changes: {},
            dateMove: {
                sessionIndex: 1,
                toDate: "2026-09-08",
                assignmentId: "forged-assignment",
            },
        });
        expect(errors.length).toBeGreaterThan(0);
    });

    it("allows an empty create body because all source provenance is server-derived", async () => {
        const errors = await validateStrict(CreateServiceRecordEditDraftDto, {});
        expect(errors).toHaveLength(0);
    });
});
