import { Prisma } from "@prisma/client";

import {
    CARRIER_CHECK_DELAY_MS,
    MessageLogEntity,
} from "domain/entities/message-log.entity";
import { MessageLogMapper } from "infrastructure/database/mapper/message-log.mapper";

describe("message log carrier check", () => {
    const createdAt = new Date("2026-10-14T00:00:00.000Z");
    const baseRow = {
        id: 7,
        branchId: "branch-1",
        provider: "aligo_sms",
        templateKey: "manual_sms",
        triggerJobId: null,
        receiver: "01012345678",
        clientId: null,
        recipientName: null,
        recipientPhone: "01012345678",
        messageBody: "message",
        variables: {},
        status: "sent",
        aligoMid: "mid-1",
        errorMessage: null,
        attempts: 1,
        lastAttemptAt: createdAt,
        nextRetryAt: null,
        createdAt,
        updatedAt: createdAt,
    };

    describe("scheduleCarrierCheck", () => {
        it("uses a 30 minute delay", () => {
            expect(CARRIER_CHECK_DELAY_MS).toBe(30 * 60 * 1000);
        });

        it("sets the due time and resets any earlier result", () => {
            const entity = MessageLogMapper.toDomain({
                ...baseRow,
                carrierCheckDueAt: null,
                carrierCheckedAt: new Date("2026-10-14T01:00:00.000Z"),
                carrierResultState: "failed",
                carrierResults: [{ receiver: "01012345678" }],
            });
            const base = new Date("2026-10-14T05:00:00.000Z");

            entity.scheduleCarrierCheck(base);

            expect(entity.carrierCheckDueAt).toEqual(new Date("2026-10-14T05:30:00.000Z"));
            expect(entity.carrierCheckedAt).toBeNull();
            expect(entity.carrierResultState).toBeNull();
            expect(entity.carrierResults).toBeNull();
        });

        it("does not mutate the base time", () => {
            const entity = MessageLogMapper.toDomain(baseRow);
            const base = new Date("2026-10-14T05:00:00.000Z");
            entity.scheduleCarrierCheck(base);
            expect(base.toISOString()).toBe("2026-10-14T05:00:00.000Z");
        });
    });

    describe("mapper", () => {
        it("defaults the carrier fields to null for rows and entities that omit them", () => {
            const entity = MessageLogMapper.toDomain(baseRow);

            expect(entity.carrierCheckDueAt).toBeNull();
            expect(entity.carrierCheckedAt).toBeNull();
            expect(entity.carrierResultState).toBeNull();
            expect(entity.carrierResults).toBeNull();
            expect(MessageLogEntity.reconstitute(
                1, null, "aligo_sms", "t", null, "r", null, "m", {}, "pending", null, null, 0, null, null,
                createdAt,
            ).carrierCheckDueAt).toBeNull();
        });

        it("round-trips the carrier fields from a row", () => {
            const dueAt = new Date("2026-10-14T05:30:00.000Z");
            const checkedAt = new Date("2026-10-14T05:31:00.000Z");
            const results = [{ receiver: "01012345678", verdict: "failure", smsState: "결번" }];

            const entity = MessageLogMapper.toDomain({
                ...baseRow,
                carrierCheckDueAt: dueAt,
                carrierCheckedAt: checkedAt,
                carrierResultState: "failed",
                carrierResults: results,
            });

            expect(entity.carrierCheckDueAt).toEqual(dueAt);
            expect(entity.carrierCheckedAt).toEqual(checkedAt);
            expect(entity.carrierResultState).toBe("failed");
            expect(entity.carrierResults).toEqual(results);

            const created = MessageLogMapper.toPrismaCreate(entity);
            expect(created.carrierCheckDueAt).toEqual(dueAt);
            expect(created.carrierCheckedAt).toEqual(checkedAt);
            expect(created.carrierResultState).toBe("failed");
            expect(created.carrierResults).toEqual(results);
        });

        it("writes JSON null for absent results on create", () => {
            const created = MessageLogMapper.toPrismaCreate(MessageLogMapper.toDomain(baseRow));
            expect(created.carrierResults).toBe(Prisma.DbNull);
        });

        it("treats a non-array carrier_results value as null", () => {
            const entity = MessageLogMapper.toDomain({ ...baseRow, carrierResults: { not: "an array" } });
            expect(entity.carrierResults).toBeNull();
        });

        it("omits carrier fields from toPrismaUpdate unless the entity scheduled a check", () => {
            const stale = MessageLogMapper.toDomain({
                ...baseRow,
                carrierCheckDueAt: null,
                carrierCheckedAt: new Date("2026-10-14T05:31:00.000Z"),
                carrierResultState: "delivered",
                carrierResults: [{}],
            });

            const data = MessageLogMapper.toPrismaUpdate(stale);

            expect(data).not.toHaveProperty("carrierCheckDueAt");
            expect(data).not.toHaveProperty("carrierCheckedAt");
            expect(data).not.toHaveProperty("carrierResultState");
            expect(data).not.toHaveProperty("carrierResults");
        });

        it("writes the scheduled due time and cleared result on toPrismaUpdate after scheduleCarrierCheck", () => {
            const entity = MessageLogMapper.toDomain(baseRow);
            entity.scheduleCarrierCheck(new Date("2026-10-14T05:00:00.000Z"));

            const data = MessageLogMapper.toPrismaUpdate(entity);

            expect(data).toMatchObject({
                carrierCheckDueAt: new Date("2026-10-14T05:30:00.000Z"),
                carrierCheckedAt: null,
                carrierResultState: null,
                carrierResults: Prisma.DbNull,
            });
        });
    });
});
