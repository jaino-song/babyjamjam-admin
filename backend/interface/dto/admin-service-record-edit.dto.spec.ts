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

    it.each([true, false])("accepts explicit suffix approval %s", async (shiftFollowing) => {
        expect(await validateStrict(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 1, changes: {}, dateMove: { sessionIndex: 1, toDate: "2026-09-08", shiftFollowing },
        })).toHaveLength(0);
    });

    it("rejects a forged non-boolean suffix approval", async () => {
        expect((await validateStrict(UpdateServiceRecordEditDraftDto, {
            expectedDraftVersion: 1, changes: {}, dateMove: { sessionIndex: 1, toDate: "2026-09-08", shiftFollowing: "true" },
        })).length).toBeGreaterThan(0);
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

    describe("schedule replacement", () => {
        const schedule = {
            serviceDays: { saturday: true, sunday: false, holiday: false },
            dates: ["2026-09-08", "2026-09-09", "2026-09-12"],
        };
        const body = (overrides: Record<string, unknown> = {}) => ({
            expectedDraftVersion: 1,
            changes: {},
            schedule,
            ...overrides,
        });

        it("accepts a whole-set replacement next to an empty changes object", async () => {
            expect(await validateStrict(UpdateServiceRecordEditDraftDto, body())).toHaveLength(0);
            expect(await validateStrict(UpdateServiceRecordEditDraftDto, body({
                changes: { header: { momName: "엄마" }, sessions: [{ sessionIndex: 1, notes: "메모" }] },
            }))).toHaveLength(0);
        });

        it.each([
            ["a missing saturday key", { serviceDays: { sunday: false, holiday: false }, dates: schedule.dates }],
            ["a missing sunday key", { serviceDays: { saturday: true, holiday: false }, dates: schedule.dates }],
            ["a missing holiday key", { serviceDays: { saturday: true, sunday: false }, dates: schedule.dates }],
            ["missing serviceDays", { dates: schedule.dates }],
            ["a non-boolean toggle", { serviceDays: { saturday: "true", sunday: false, holiday: false }, dates: schedule.dates }],
            ["a numeric toggle", { serviceDays: { saturday: 1, sunday: 0, holiday: 0 }, dates: schedule.dates }],
            ["an unknown serviceDays key", { serviceDays: { ...schedule.serviceDays, weekend: true }, dates: schedule.dates }],
            ["an unknown schedule key", { ...schedule, shiftFollowing: true }],
            ["missing dates", { serviceDays: schedule.serviceDays }],
            ["empty dates", { serviceDays: schedule.serviceDays, dates: [] }],
            ["too many dates", { serviceDays: schedule.serviceDays, dates: Array.from({ length: 367 }, () => "2026-09-08") }],
            ["a slashed date", { serviceDays: schedule.serviceDays, dates: ["2026/09/08"] }],
            ["a timestamp", { serviceDays: schedule.serviceDays, dates: ["2026-09-08T00:00:00.000Z"] }],
            ["a non-string date", { serviceDays: schedule.serviceDays, dates: [20260908] }],
        ])("rejects %s", async (_label, invalid) => {
            expect((await validateStrict(UpdateServiceRecordEditDraftDto, body({ schedule: invalid }))).length)
                .toBeGreaterThan(0);
        });

        it("accepts up to 366 dates", async () => {
            const dates = Array.from({ length: 366 }, () => "2026-09-08");
            expect(await validateStrict(UpdateServiceRecordEditDraftDto, body({
                schedule: { serviceDays: schedule.serviceDays, dates },
            }))).toHaveLength(0);
        });

        it("leaves the schedule/dateMove pairing to the service, which answers with a scheduleCode", async () => {
            // Pipe-level rejection would drop the SCHEDULE_WITH_DATE_MOVE scheduleCode the editor relies on.
            expect(await validateStrict(UpdateServiceRecordEditDraftDto, body({
                dateMove: { sessionIndex: 1, toDate: "2026-09-08" },
            }))).toHaveLength(0);
        });

        it("keeps serviceDays server-produced: the client changes object rejects it", async () => {
            expect((await validateStrict(UpdateServiceRecordEditDraftDto, {
                expectedDraftVersion: 1,
                changes: { serviceDays: schedule.serviceDays },
            })).length).toBeGreaterThan(0);
            expect((await validateStrict(ServiceRecordEditChangesDto, { serviceDays: schedule.serviceDays })).length)
                .toBeGreaterThan(0);
            expect((await validateStrict(CreateServiceRecordEditDraftDto, {
                changes: { serviceDays: schedule.serviceDays },
            })).length).toBeGreaterThan(0);
        });
    });

    it("allows an empty create body because all source provenance is server-derived", async () => {
        const errors = await validateStrict(CreateServiceRecordEditDraftDto, {});
        expect(errors).toHaveLength(0);
    });
});
