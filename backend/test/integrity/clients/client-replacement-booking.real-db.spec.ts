import { BadRequestException } from "@nestjs/common";

import { SERVICE_STATUS, computeServiceStatus } from "domain/value-objects/service-status.vo";
import { BOOKING_STATUS_CONFIRM_ONLY_DETAIL } from "application/usecases/client/client-write-validation";

import { assertThrowawayTarget, closeIntegrityPrisma, createIntegrityPrisma, describeReal, type IntegrityPrisma } from "../helpers/real-db";
import { RowTracker } from "../helpers/tracker";
import { createBranch, createClient } from "../helpers/factories";
import { invariant, knownDefect } from "../helpers/known-defect";
import { addDays, dbDate, isoDateInKorea, makeClientService } from "./test-helpers";

jest.setTimeout(120_000);

/**
 * SI-CLIENT-02 — `ClientService.completeReplacement` refuses nothing.
 * Invariant: completing a replacement must refuse (or be a no-op) unless the
 * client is in `replacement_requested`. Today the guard is a logged warning;
 * the write proceeds and recomputes the status from the dates, so a
 * `terminated` (or any other) client is silently un-terminated.
 *
 * SI-CLIENT-06 — booking confirmation is the only exit from 예약 전, and
 * confirming twice is a no-op. Invariants: a plain save cannot move a client
 * into or out of `pre_booking` (client-write-validation
 * resolveSavedServiceStatus; only `terminated` is deliberately allowed out of
 * an unconfirmed client), `confirmBooking` stores `bookingConfirmedAt` + the
 * date-derived status once, and a second confirm leaves the row untouched.
 */
describeReal("SI-CLIENT-02/06 replacement guard and booking-confirmation exclusivity", () => {
    let handle: IntegrityPrisma;
    let tracker: RowTracker;
    let branchId: string;
    let kstToday: string;

    beforeAll(async () => {
        assertThrowawayTarget();
        handle = await createIntegrityPrisma();
        tracker = new RowTracker();
        kstToday = isoDateInKorea(new Date());
        const branch = await createBranch(handle.raw, tracker);
        branchId = branch.id;
    });

    afterAll(async () => {
        if (tracker) await tracker.cleanup(handle.raw);
        if (handle) await closeIntegrityPrisma(handle);
    });

    const createPeriodClient = async (overrides: { serviceStatus: string | null; confirmed: boolean }) => {
        return createClient(handle.raw, tracker, {
            branchId,
            startDate: dbDate(addDays(kstToday, -20)),
            endDate: dbDate(addDays(kstToday, 10)),
            bookingConfirmedAt: overrides.confirmed ? new Date() : null,
            serviceStatus: overrides.serviceStatus,
        });
    };

    knownDefect(
        "SI-CLIENT-02",
        "completeReplacement refuses unless the client is in replacement_requested",
        async () => {
            const client = await createPeriodClient({ serviceStatus: SERVICE_STATUS.TERMINATED, confirmed: true });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            const outcome = await service.completeReplacement(branchId, client.id).then(
                () => "completed" as const,
                () => "refused" as const,
            );
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { serviceStatus: true },
            });
            // Whether or not something threw, the row must be unchanged.
            if (row.serviceStatus !== SERVICE_STATUS.TERMINATED) {
                throw new Error(
                    `SI-CLIENT-02: completeReplacement ran on a "${SERVICE_STATUS.TERMINATED}" client and moved the status to "${row.serviceStatus}" (outcome ${outcome}; only a warning was logged)`,
                );
            }
        },
        /SI-CLIENT-02: completeReplacement ran on a "terminated" client and moved the status to "active"/,
    );

    invariant(
        "SI-CLIENT-02",
        "control: completeReplacement completes a client that IS in replacement_requested",
        async () => {
            const client = await createPeriodClient({
                serviceStatus: SERVICE_STATUS.REPLACEMENT_REQUESTED,
                confirmed: true,
            });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            const updated = await service.completeReplacement(branchId, client.id);
            const expected = computeServiceStatus(
                null,
                dbDate(addDays(kstToday, -20)),
                dbDate(addDays(kstToday, 10)),
                client.bookingConfirmedAt,
            );
            if (updated.serviceStatus !== expected) {
                throw new Error(
                    `SI-CLIENT-02 control failed: completeReplacement stored "${String(updated.serviceStatus)}", expected the date-derived "${expected}"`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-06",
        "a plain save cannot move an unconfirmed client out of pre_booking into a date-derived status",
        async () => {
            const client = await createPeriodClient({ serviceStatus: SERVICE_STATUS.PRE_BOOKING, confirmed: false });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            for (const status of [SERVICE_STATUS.WAITING, SERVICE_STATUS.ACTIVE, SERVICE_STATUS.COMPLETED]) {
                await expect(
                    service.update(branchId, client.id, { serviceStatus: status }),
                ).rejects.toMatchObject({
                    response: expect.objectContaining({ message: BOOKING_STATUS_CONFIRM_ONLY_DETAIL }),
                });
            }
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { serviceStatus: true },
            });
            if (row.serviceStatus !== SERVICE_STATUS.PRE_BOOKING) {
                throw new Error(
                    `SI-CLIENT-06: a refused save still changed the stored status to "${String(row.serviceStatus)}"`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-06",
        "a confirmed client cannot be moved back into pre_booking by a plain save",
        async () => {
            const client = await createPeriodClient({ serviceStatus: SERVICE_STATUS.ACTIVE, confirmed: true });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            await expect(
                service.update(branchId, client.id, { serviceStatus: SERVICE_STATUS.PRE_BOOKING }),
            ).rejects.toMatchObject({
                response: expect.objectContaining({ message: BOOKING_STATUS_CONFIRM_ONLY_DETAIL }),
            });
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { serviceStatus: true },
            });
            if (row.serviceStatus !== SERVICE_STATUS.ACTIVE) {
                throw new Error(
                    `SI-CLIENT-06: a refused pre_booking save changed the stored status to "${String(row.serviceStatus)}"`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-06",
        "the deliberate exception holds: an unconfirmed client may still be saved as terminated",
        async () => {
            const client = await createPeriodClient({ serviceStatus: SERVICE_STATUS.PRE_BOOKING, confirmed: false });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            await service.update(branchId, client.id, { serviceStatus: SERVICE_STATUS.TERMINATED });
            const row = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { serviceStatus: true },
            });
            if (row.serviceStatus !== SERVICE_STATUS.TERMINATED) {
                throw new Error(
                    `SI-CLIENT-06: the terminated escape hatch stored "${String(row.serviceStatus)}"`,
                );
            }
        },
    );

    invariant(
        "SI-CLIENT-06",
        "confirmBooking stores bookingConfirmedAt + the date-derived status once; a double confirm is a no-op",
        async () => {
            const client = await createPeriodClient({ serviceStatus: SERVICE_STATUS.PRE_BOOKING, confirmed: false });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });

            const confirmedOnce = await service.confirmBooking(branchId, client.id);
            const expected = computeServiceStatus(
                null,
                dbDate(addDays(kstToday, -20)),
                dbDate(addDays(kstToday, 10)),
                confirmedOnce.bookingConfirmedAt ? new Date(confirmedOnce.bookingConfirmedAt) : null,
            );
            if (!confirmedOnce.bookingConfirmedAt) {
                throw new Error("SI-CLIENT-06: confirmBooking did not store bookingConfirmedAt");
            }
            if (confirmedOnce.serviceStatus !== expected) {
                throw new Error(
                    `SI-CLIENT-06: confirmBooking stored status "${String(confirmedOnce.serviceStatus)}", expected "${expected}"`,
                );
            }

            const firstConfirmedAt = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { bookingConfirmedAt: true, serviceStatus: true },
            });

            // Double click: the second confirm must return the client untouched.
            await service.confirmBooking(branchId, client.id);
            const afterSecond = await handle.raw.client.findUniqueOrThrow({
                where: { id: client.id },
                select: { bookingConfirmedAt: true, serviceStatus: true },
            });
            if (afterSecond.bookingConfirmedAt?.getTime() !== firstConfirmedAt.bookingConfirmedAt?.getTime()) {
                throw new Error("SI-CLIENT-06: a second confirmBooking rewrote bookingConfirmedAt");
            }
            if (afterSecond.serviceStatus !== firstConfirmedAt.serviceStatus) {
                throw new Error("SI-CLIENT-06: a second confirmBooking rewrote serviceStatus");
            }
        },
    );

    invariant(
        "SI-CLIENT-06",
        "control: a refused booking-status save surfaces the confirm-only refusal as BadRequest",
        async () => {
            const client = await createPeriodClient({ serviceStatus: SERVICE_STATUS.PRE_BOOKING, confirmed: false });
            const service = makeClientService({ prisma: handle.service, raw: handle.raw });
            const error = await service.update(branchId, client.id, { serviceStatus: SERVICE_STATUS.ACTIVE }).catch(
                (caught: unknown) => caught,
            );
            if (!(error instanceof BadRequestException)) {
                throw new Error(
                    `SI-CLIENT-06 control failed: expected BadRequestException, got ${String(error)}`,
                );
            }
        },
    );
});
