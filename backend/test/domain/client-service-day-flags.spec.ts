import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";

import { ClientEntity, mergeServiceDayPolicy, serviceDayPolicyOf } from "domain/entities/client.entity";
import { KR_BUILTIN_CALENDAR } from "domain/utils/business-days";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { CreateClientDto, UpdateClientDto } from "interface/dto/client.dto";

const FLAGS = ["allowSaturdayService", "allowSundayService", "allowHolidayService"] as const;

const row = {
    id: 1,
    name: "Row Client",
    address: null,
    phone: "010-1234-5678",
    type: null,
    duration: null,
    fullPrice: null,
    grant: null,
    actualPrice: null,
    startDate: null,
    endDate: null,
    careCenter: false,
    voucherClient: true,
    birthday: null,
    serviceStatus: null,
    bookingConfirmedAt: null,
    breastPump: false,
    eDocId: null,
};

describe("serviceDayPolicyOf", () => {
    it("maps flags to the policy and treats missing flags as not allowed", () => {
        expect(serviceDayPolicyOf({})).toEqual({ saturday: false, sunday: false, holiday: false });
        expect(serviceDayPolicyOf({ allowSaturdayService: true, allowHolidayService: true }))
            .toEqual({ saturday: true, sunday: false, holiday: true });
    });

    it("merges a patch over the current flags, one flag at a time", () => {
        const current = { allowSaturdayService: true, allowSundayService: false, allowHolidayService: true };
        expect(mergeServiceDayPolicy(current, {})).toEqual({ saturday: true, sunday: false, holiday: true });
        expect(mergeServiceDayPolicy(current, { allowSundayService: true })).toEqual({ saturday: true, sunday: true, holiday: true });
        expect(mergeServiceDayPolicy(current, { allowSaturdayService: false })).toEqual({ saturday: false, sunday: false, holiday: true });
    });
});

describe("client service-day flag mapping", () => {
    it("round-trips the three flags from row to entity to Prisma create and update data", () => {
        const entity = ClientMapper.toDomain({
            ...row,
            allowSaturdayService: true,
            allowSundayService: false,
            allowHolidayService: true,
        });
        expect(entity.allowSaturdayService).toBe(true);
        expect(entity.allowSundayService).toBe(false);
        expect(entity.allowHolidayService).toBe(true);
        for (const data of [ClientMapper.toPrismaCreate(entity), ClientMapper.toPrismaUpdate(entity)]) {
            expect(data).toMatchObject({
                allowSaturdayService: true,
                allowSundayService: false,
                allowHolidayService: true,
            });
        }
    });

    it("reads a row without the flags as all false", () => {
        const entity = ClientMapper.toDomain(row);
        expect(FLAGS.map((flag) => entity[flag])).toEqual([false, false, false]);
        expect(ClientMapper.toPrismaCreate(entity)).toMatchObject({
            allowSaturdayService: false,
            allowSundayService: false,
            allowHolidayService: false,
        });
    });

    it("keeps the flags through a created entity", () => {
        const entity = ClientEntity.create({
            name: "c", address: null, phone: "010-1234-5678", type: null, duration: null, fullPrice: null,
            grant: null, actualPrice: null, startDate: null, endDate: null, careCenter: false, voucherClient: true,
            birthday: null, dueDate: null, birthDate: null, serviceStatus: null, breastPump: false, eDocId: null,
            allowSundayService: true,
        }, KR_BUILTIN_CALENDAR);
        expect(ClientMapper.toPrismaCreate(entity)).toMatchObject({
            allowSaturdayService: false,
            allowSundayService: true,
            allowHolidayService: false,
        });
    });
});

describe("client service-day flag DTOs", () => {
    const createBody = { name: "홍길동", voucherClient: true, breastPump: false };

    it("create validates without the flags and with booleans", async () => {
        expect(await validate(plainToInstance(CreateClientDto, createBody))).toHaveLength(0);
        expect(await validate(plainToInstance(CreateClientDto, {
            ...createBody,
            allowSaturdayService: true,
            allowSundayService: false,
            allowHolidayService: true,
        }))).toHaveLength(0);
    });

    it.each(FLAGS)("create rejects a non-boolean %s", async (flag) => {
        for (const value of ["yes", 1, "true"]) {
            const errors = await validate(plainToInstance(CreateClientDto, { ...createBody, [flag]: value }));
            expect(errors.map((e) => e.property)).toContain(flag);
        }
    });

    it("update accepts booleans and omission", async () => {
        expect(await validate(plainToInstance(UpdateClientDto, {}))).toHaveLength(0);
        expect(await validate(plainToInstance(UpdateClientDto, { allowSaturdayService: true, allowSundayService: false }))).toHaveLength(0);
    });

    it.each(FLAGS)("update rejects null and non-boolean %s", async (flag) => {
        for (const value of [null, "yes", 1]) {
            const errors = await validate(plainToInstance(UpdateClientDto, { [flag]: value }));
            expect(errors.map((e) => e.property)).toContain(flag);
        }
    });
});
