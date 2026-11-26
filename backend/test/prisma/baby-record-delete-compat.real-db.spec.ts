import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";

import { DeleteClientUsecase } from "application/usecases/client/delete-client.usecase";
import { DeleteEmployeeScheduleUsecase } from "application/usecases/employee-schedule/delete-employee-schedule.usecase";
import { SCHEDULE_RETENTION_BLOCKED } from "domain/errors/retention-delete-blocked.error";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { SbEmployeeScheduleRepository } from "infrastructure/database/repositories/sb.employee-schedule.repository";

import { assertThrowawayTarget, describeReal } from "../integrity/helpers/real-db";

const PHONE = "01000000000";
const ROLLBACK_FIXTURES = new Error("Roll back the synthetic delete compatibility fixtures");

function futureDate(days: number): Date {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() + days);
    return date;
}

async function createFixtures(tx: Prisma.TransactionClient) {
    const { id: branchId } = await tx.branch.create({
        data: { name: "QA-Baby record delete", slug: `qa-baby-delete-${randomUUID()}` },
    });
    const client = await tx.client.create({
        data: { branchId, name: "QA-Client", voucherClient: true, phone: PHONE, phoneNormalized: PHONE },
    });

    // Reuse the real fixture transaction when a repository owns its transaction.
    // The history triggers stay enabled and rollback removes even immutable rows.
    const prisma = new Proxy(tx, {
        get(target, key, receiver) {
            if (key === "$transaction") {
                return (callback: (transaction: Prisma.TransactionClient) => Promise<unknown>) => callback(target);
            }
            return Reflect.get(target, key, receiver);
        },
    }) as PrismaService;

    return {
        tx,
        branchId,
        clientId: client.id,
        deleteClient: new DeleteClientUsecase(new SbClientRepository(prisma)),
        deleteSchedule: new DeleteEmployeeScheduleUsecase(new SbEmployeeScheduleRepository(prisma)),
        mirror: new SbEformsignDocumentMirrorRepository(prisma),
        createBaby: (active: boolean) => tx.client_baby.create({
            data: { branchId, clientId: client.id, ordinal: 1, active, legacyBackfilled: true },
        }),
        createFutureSchedule: async () => {
            const employee = await tx.employee.create({
                data: { branchId, name: "QA-Employee", phone: PHONE, grade: "스탠다드" },
            });
            return tx.employee_schedule.create({
                data: {
                    branchId,
                    clientId: client.id,
                    primaryEmployeeId: employee.id,
                    workAddress: "QA-Address",
                    startDate: futureDate(7),
                    endDate: futureDate(14),
                },
            });
        },
        createDocument: (autoRegisteredClient: boolean, serviceRecordCaseId?: string) => {
            const now = new Date();
            return tx.eformsign_doc.create({
                data: {
                    branchId,
                    clientId: client.id,
                    documentId: `qa-baby-delete-${randomUUID()}`,
                    autoRegisteredClient,
                    serviceRecordCaseId,
                    customerName: "QA-Client",
                    createdDate: now,
                    updatedDate: now,
                    statusType: "completed",
                    statusDetail: "completed",
                    stepType: "final",
                    stepIndex: "1",
                    stepName: "final",
                    stepRecipientType: "client",
                    stepRecipientName: "QA-Recipient",
                    stepRecipientSms: PHONE,
                    expiredDate: futureDate(1),
                },
            });
        },
    };
}

describeReal("baby record deletion compatibility (real PostgreSQL)", () => {
    let prisma: PrismaService;
    let restoreEnv: () => void;

    beforeAll(() => {
        assertThrowawayTarget();
        const env = jest.replaceProperty(process, "env", {
            ...process.env,
            CLIENT_TOMBSTONE_DELETE_ENABLED: "true",
        });
        restoreEnv = () => env.restore();
        prisma = new PrismaService();
    });

    afterAll(async () => {
        restoreEnv?.();
        await prisma?.$disconnect();
    });

    async function withFixtures(test: (fixtures: Awaited<ReturnType<typeof createFixtures>>) => Promise<void>) {
        await expect(prisma.$transaction(async (tx) => {
            await test(await createFixtures(tx));
            throw ROLLBACK_FIXTURES;
        })).rejects.toBe(ROLLBACK_FIXTURES);
    }

    it.each([true, false])("tombstones a client whose sole dependency is a baby with active=%s", (active) =>
        withFixtures(async ({ tx, branchId, clientId, createBaby, deleteClient }) => {
            const baby = await createBaby(active);

            await expect(deleteClient.execute(randomUUID(), clientId)).rejects.toMatchObject({ status: 404 });
            await expect(deleteClient.execute(branchId, clientId)).resolves.toBe("tombstoned");

            expect(await tx.client.findUniqueOrThrow({ where: { id: clientId } })).toMatchObject({
                branchId,
                deletedAt: expect.any(Date),
                phone: PHONE,
                phoneNormalized: null,
            });
            expect(await tx.client_baby.findUnique({ where: { id: baby.id } })).toEqual(baby);
        }),
    );

    it.each([true, false])("returns the existing retention conflict for a future schedule with slot active=%s", (active) =>
        withFixtures(async ({ tx, branchId, clientId, createBaby, createFutureSchedule, deleteSchedule }) => {
            const schedule = await createFutureSchedule();
            const slot = await tx.service_record_team_slot.create({
                data: {
                    branchId,
                    clientId,
                    scheduleId: schedule.id,
                    employeeId: schedule.primaryEmployeeId,
                    slot: 0,
                    active,
                    legacyBackfilled: true,
                },
            });
            // The active case has only a slot. The retired case also has closed ownership history.
            const assignment = active ? null : await tx.service_record_baby_assignment.create({
                data: {
                    branchId,
                    clientId,
                    scheduleId: schedule.id,
                    employeeId: schedule.primaryEmployeeId,
                    teamSlotId: slot.id,
                    babyId: (await createBaby(false)).id,
                    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
                    endedAt: new Date("2026-01-02T00:00:00Z"),
                    activeOwner: null,
                },
            });

            await expect(deleteSchedule.execute(branchId, schedule.id, tx))
                .rejects.toMatchObject({ status: 409, response: { code: SCHEDULE_RETENTION_BLOCKED } });

            expect(await tx.employee_schedule.findUnique({ where: { id: schedule.id } })).toEqual(schedule);
            expect(await tx.service_record_team_slot.findUnique({ where: { id: slot.id } })).toEqual(slot);
            if (assignment) {
                expect(await tx.service_record_baby_assignment.findUnique({ where: { id: assignment.id } })).toEqual(assignment);
            }
        }),
    );

    it("still hard-deletes a dependency-free future schedule and its now dependency-free client", () =>
        withFixtures(async ({ tx, branchId, clientId, createFutureSchedule, deleteSchedule, deleteClient }) => {
            const schedule = await createFutureSchedule();

            await deleteSchedule.execute(branchId, schedule.id, tx);
            await expect(deleteClient.execute(branchId, clientId)).resolves.toBe("deleted");

            expect(await tx.employee_schedule.findUnique({ where: { id: schedule.id } })).toBeNull();
            expect(await tx.client.findUnique({ where: { id: clientId } })).toBeNull();
        }),
    );

    it("keeps a legacy case ID and document on client deletion after the case has been linked to a baby", () =>
        withFixtures(async ({ tx, branchId, clientId, createBaby, createDocument, deleteClient }) => {
            const legacyCase = await tx.service_record_case.create({ data: { branchId, clientId } });
            const linkedCase = await tx.service_record_case.update({
                where: { id: legacyCase.id },
                data: { babyId: (await createBaby(true)).id },
            });
            const doc = await createDocument(false, legacyCase.id);

            await expect(deleteClient.execute(branchId, clientId)).resolves.toBe("tombstoned");

            expect(await tx.service_record_case.findUnique({ where: { id: legacyCase.id } })).toEqual(linkedCase);
            expect(await tx.eformsign_doc.findUnique({ where: { id: doc.id } })).toEqual(doc);
        }),
    );

    it.each([true, false])("scrubs the document and rolls back auto-registration only without baby history (baby present=%s)", (hasBaby) =>
        withFixtures(async ({ tx, branchId, clientId, createBaby, createDocument, mirror }) => {
            const doc = await createDocument(true);
            await tx.client.update({ where: { id: clientId }, data: { eDocId: doc.documentId } });
            const baby = hasBaby ? await createBaby(false) : null;
            const legacyCase = await tx.service_record_case.create({
                data: { branchId, clientId, babyId: baby?.id },
            });

            await mirror.purgeContent([doc.documentId], new Date());

            expect(await tx.eformsign_doc.findUnique({ where: { id: doc.id } })).toMatchObject({
                documentId: doc.documentId,
                statusType: "049",
                clientId: null,
                autoRegisteredClient: false,
                customerName: null,
            });
            const remainingClient = await tx.client.findUnique({ where: { id: clientId } });
            const remainingCase = await tx.service_record_case.findUnique({ where: { id: legacyCase.id } });
            if (baby) {
                expect(remainingClient).toMatchObject({ id: clientId, eDocId: null, deletedAt: null });
                expect(remainingCase).toEqual(legacyCase);
                expect(await tx.client_baby.findUnique({ where: { id: baby.id } })).toEqual(baby);
            } else {
                expect(remainingClient).toBeNull();
                expect(remainingCase).toBeNull();
            }
        }),
    );
});
