import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { EformsignDocumentJobService, sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { parseContractCopaymentReceivedDate } from "application/utils/contract-copayment-date";
import { ClientMapper } from "infrastructure/database/mapper/client.mapper";
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";

import { B, U, data, intentInput, runtimeFixture, worker, workflowPlan } from "../utils/eformsign-contract-recovery.fixture";

const DATE_A = "2026-11-20";
const DATE_B = "2026-11-21";
const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);
const contractData = { ...data, paymentYear: "26", paymentMonth: "11", paymentDay: "21", copaymentReceivedDate: DATE_B };
const principal = { branchId: B, userId: U, branchRole: "manager" } as const;
const enqueueRequest = { branchId: B, clientId: 2, requestKey: "new-request", contractData };

function setup(date: string | null = DATE_A) {
    const fixture = runtimeFixture();
    fixture.state.clients[0].copaymentReceivedDate = date && dbDate(date);
    const repository = new SbEformsignDocumentJobRepository(fixture.prisma);
    const findById = jest.fn(async (branch: string, id: number) =>
        fixture.state.clients.find((row: { id: number; branchId: string }) => row.id === id && row.branchId === branch) ?? null);
    const jobService = new EformsignDocumentJobService(repository, {} as never, { findById } as never);
    return { ...fixture, jobService, findById };
}

function withoutActiveContract(fixture: ReturnType<typeof setup>) {
    fixture.state.jobs = [];
    fixture.state.authorities = [];
    fixture.state.intents = [];
}

function directDispatch(fixture: ReturnType<typeof setup>) {
    const boundary = new EformsignDispatchBoundaryService(
        new SbEformsignDispatchIntentRepository(fixture.prisma),
        fixture.repository,
    );
    const dispatchCreation = jest.fn().mockImplementation(async () => {
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_B));
        return { ok: false, reason: "editor_load_timeout", durationMs: 1 };
    });
    const assertLiveAssignedProvider = jest.fn(async (branch: string) => {
        if (branch !== B) throw new ConflictException("CLIENT_ASSIGNMENT_REQUIRED");
        return { scheduleId: 9 };
    });
    const usecase = new DispatchDocumentHeadlessUsecase(
        fixture.options,
        { dispatchCreation } as never,
        { findByArea: jest.fn() } as never,
        fixture.credentials,
        {} as never, {} as never, { emit: jest.fn() } as never, {} as never,
        { assertLiveAssignedProvider } as never,
        { findByClientId: jest.fn().mockResolvedValue([]) } as never,
        {} as never,
        fixture.provider,
        undefined,
        boundary,
    );
    return { usecase, dispatchCreation, assertLiveAssignedProvider };
}

describe("contract copayment date acceptance", () => {
    it("ships only an additive nullable DATE migration and serializes the stored day without a local offset", () => {
        const migration = readFileSync(resolve(__dirname,
            "../../prisma/migrations/20261123000000_add_client_copayment_received_date/migration.sql"), "utf8");
        expect(migration.replace(/^--.*$/gm, "").trim()).toMatch(
            /^ALTER TABLE "client" ADD COLUMN\s+"copayment_received_date" DATE;$/,
        );
        const parsed = parseContractCopaymentReceivedDate(contractData);
        expect(parsed).toEqual(dbDate(DATE_B));
        const entity = ClientMapper.toDomain({
            id: 2, name: "Fixture", eDocId: null, copaymentReceivedDate: parsed,
        } as Parameters<typeof ClientMapper.toDomain>[0]);
        expect(JSON.parse(JSON.stringify(entity)).copaymentReceivedDate).toBe(DATE_B);
        expect(ClientMapper.toPrismaCreate(entity)).not.toHaveProperty("copaymentReceivedDate");
        expect(ClientMapper.toPrismaUpdate(entity)).not.toHaveProperty("copaymentReceivedDate");
    });

    it("writes B with the fresh desktop job and retains A during replay, active duplicates and fingerprint conflicts", async () => {
        const fixture = setup();
        withoutActiveContract(fixture);
        const first = await fixture.jobService.enqueueCreateDocument(enqueueRequest);
        expect(first.existing).toBe(false);
        expect(fixture.events).toEqual(["jobs.insert", "authority.insert", "clients.updateMany"]);
        expect(fixture.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(fixture.state.clients[0]).toMatchObject({ copaymentReceivedDate: dbDate(DATE_B), eDocId: "prior-doc" });
        fixture.state.clients[0].copaymentReceivedDate = dbDate(DATE_A);

        await expect(fixture.jobService.enqueueCreateDocument(enqueueRequest)).resolves.toMatchObject({ existing: true, job: { id: first.job.id } });
        await expect(fixture.jobService.enqueueCreateDocument({ ...enqueueRequest, requestKey: "active-duplicate" }))
            .resolves.toMatchObject({ existing: true, job: { id: first.job.id } });
        await expect(fixture.jobService.enqueueCreateDocument({
            ...enqueueRequest, contractData: { ...contractData, copaymentReceivedDate: DATE_A, paymentDay: "20" },
        })).rejects.toThrow("IDEMPOTENCY_MISMATCH");
        expect(fixture.tx.client.updateMany).toHaveBeenCalledTimes(1);
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));
        expect(fixture.state.jobs[0].payload.contractData.copaymentReceivedDate).toBe(DATE_B);
    });

    it.each([DATE_A, null])("preserves %s for legacy desktop and mobile calls without an explicit date", async (savedDate) => {
        const fixture = setup(savedDate);
        withoutActiveContract(fixture);
        const legacy = await fixture.jobService.enqueueCreateDocument({ ...enqueueRequest, contractData: data });
        expect(legacy.job.payloadFingerprint).toBe(sha256CanonicalJson({ clientId: 2, contractData: data }));
        fixture.state.authorities = [];
        await expect(fixture.repository.claimLegacyCreation(intentInput)).resolves.toMatchObject({ disposition: "claimed" });
        expect(fixture.tx.client.updateMany).not.toHaveBeenCalled();
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(savedDate && dbDate(savedDate));
    });

    it.each([
        { copaymentReceivedDate: "26-11-21" },
        { copaymentReceivedDate: "2026-02-29", paymentMonth: "02", paymentDay: "29" },
        { copaymentReceivedDate: DATE_A },
        { copaymentReceivedDate: null },
    ])("rejects invalid or inconsistent dates in either entry point (%j)", async (overrides) => {
        const fixture = setup();
        const { usecase, assertLiveAssignedProvider } = directDispatch(fixture);
        const invalid = { ...contractData, ...overrides } as typeof contractData;
        await expect(fixture.jobService.enqueueCreateDocument({ ...enqueueRequest, contractData: invalid })).rejects.toBeInstanceOf(BadRequestException);
        await expect(usecase.execute(B, { clientId: 2, contractData: invalid, saveCopaymentReceivedDate: true }, principal)).rejects.toBeInstanceOf(BadRequestException);
        expect(assertLiveAssignedProvider).not.toHaveBeenCalled();
        expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));
    });

    it("refuses a foreign-branch client by id in both entry points", async () => {
        const fixture = setup();
        const { usecase, dispatchCreation } = directDispatch(fixture);
        const branchId = U;
        await expect(fixture.jobService.enqueueCreateDocument({ ...enqueueRequest, branchId })).rejects.toBeInstanceOf(NotFoundException);
        expect(fixture.findById).toHaveBeenCalledWith(branchId, 2);
        await expect(usecase.execute(branchId, { clientId: 2, contractData, saveCopaymentReceivedDate: true }, { ...principal, branchId }))
            .resolves.toMatchObject({ ok: false });
        expect(dispatchCreation).not.toHaveBeenCalled();
        expect(fixture.prisma.$transaction).not.toHaveBeenCalled();
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));
    });

    it("retains B after a known pre-send failure and leaves newer A intact on another attempt of that claim", async () => {
        const fixture = setup();
        withoutActiveContract(fixture);
        const { usecase, dispatchCreation } = directDispatch(fixture);
        const params = { clientId: 2, contractData, saveCopaymentReceivedDate: true };
        await expect(usecase.execute(B, params, principal)).resolves.toMatchObject({ ok: false, fallbackHint: "iframe" });
        expect(fixture.events.slice(0, 3)).toEqual(["intents.create", "intents.updateMany", "clients.updateMany"]);
        expect(fixture.state.intents[0].status).toBe("prepared");
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_B));

        fixture.state.clients[0].copaymentReceivedDate = dbDate(DATE_A);
        dispatchCreation.mockResolvedValue({ ok: false, reason: "editor_load_timeout", durationMs: 1 });
        await expect(usecase.execute(B, params, principal)).resolves.toMatchObject({ ok: false, fallbackHint: "iframe" });
        expect(fixture.state.intents[0].attemptCount).toBe(2);
        expect(fixture.tx.client.updateMany).toHaveBeenCalledTimes(1);
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));
    });

    it.each(["accepted", "uncertain"])("leaves A intact when mobile replays a previously %s claim", async (status) => {
        const fixture = setup();
        fixture.state.authorities = [];
        Object.assign(fixture.state.intents[0], {
            status, attemptCount: 1, providerDocumentId: status === "accepted" ? "bound-doc" : null,
        });
        const result = await fixture.repository.claimLegacyCreation(intentInput, dbDate(DATE_B));
        expect(result.disposition).toBe(status === "accepted" ? "already_accepted" : "uncertain");
        expect(fixture.tx.client.updateMany).not.toHaveBeenCalled();
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));
    });

    it("rolls back fresh durable work if the date write finds no eligible client", async () => {
        const desktop = setup();
        withoutActiveContract(desktop);
        desktop.tx.client.updateMany.mockResolvedValue({ count: 0 });
        await expect(desktop.jobService.enqueueCreateDocument(enqueueRequest)).rejects.toBeInstanceOf(ConflictException);
        expect(desktop.state.jobs).toHaveLength(0);
        expect(desktop.state.authorities).toHaveLength(0);
        expect(desktop.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));

        const mobile = setup();
        withoutActiveContract(mobile);
        mobile.tx.client.updateMany.mockResolvedValue({ count: 0 });
        await expect(mobile.repository.claimLegacyCreation(intentInput, dbDate(DATE_B))).rejects.toBeInstanceOf(ConflictException);
        expect(mobile.state.intents).toHaveLength(0);
        expect(mobile.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));
    });

    it("keeps the latest date through worker dispatch and completion of an earlier contract", async () => {
        const fixture = setup();
        const payload = { clientId: 2, contractData };
        const payloadFingerprint = sha256CanonicalJson(payload);
        const fingerprint = createHash("sha256")
            .update(JSON.stringify({ contractData, generation: intentInput.generation }))
            .digest("hex");
        Object.assign(fixture.state.jobs[0], { payload, payloadFingerprint });
        Object.assign(fixture.state.authorities[0], { fingerprint: payloadFingerprint });
        Object.assign(fixture.state.intents[0], { fingerprint });
        const { intent } = await fixture.repository.claimCreation({ ...intentInput, fingerprint }, worker,
            { contractData, workflow: workflowPlan });
        await new SbEformsignDispatchIntentRepository(fixture.prisma).markAccepted(intent.id, B, intent.attemptCount, "bound-doc");
        fixture.forward();
        await fixture.service.completeAutomatic(worker, "bound-doc", { branchId: B, source: "worker" });
        expect(fixture.state.jobs[0].status).toBe("completed");
        expect(fixture.state.clients[0]).toMatchObject({ eDocId: "bound-doc", copaymentReceivedDate: dbDate(DATE_A) });
    });

    it("adopts an earlier document without sending its historical date to the client writer", async () => {
        const fixture = setup();
        const create = jest.fn().mockResolvedValue({ documentId: "bound-doc" });
        const remote = { ...fixture.remote, fields: [{ id: "본인부담금 수령일", value: DATE_B }] };
        const usecase = new AdoptEformsignDocUsecase(
            fixture.credentials,
            { execute: jest.fn().mockResolvedValue(remote) } as never,
            { execute: create } as never,
            { findById: fixture.findById } as never,
            { syncDocumentWithToken: jest.fn() } as never,
            {} as never,
        );
        await usecase.execute(B, { documentId: "bound-doc", clientId: 2 }, principal);
        expect(create).toHaveBeenCalledWith(B, expect.objectContaining({ clientId: 2, linkToClient: true }));
        expect(create.mock.calls[0]?.[1]).not.toHaveProperty("copaymentReceivedDate");
        expect(fixture.state.clients[0].copaymentReceivedDate).toEqual(dbDate(DATE_A));
    });
});
