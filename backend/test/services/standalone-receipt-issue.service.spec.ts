import { ForbiddenException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { StandaloneReceiptIssueService } from "application/services/standalone-receipt-issue.service";
import { StandaloneReceiptTemplateLoader } from "infrastructure/pdf/standalone-receipt-template.loader";
import { FileStorageObjectNotFoundError } from "domain/ports/file-storage.port";

const branchId = randomUUID();
const otherBranch = randomUUID();
const pinnedDigest = "ab20ef494186f1bc3d480dcb96facc67c753de72d6d03dc3a7b7fc85f639548f";
const key = (branch: string) => `standalone-receipt-templates/${branch}/${pinnedDigest}.png`;
const fixture = readFileSync(join(__dirname, "../fixtures/standalone-receipt-synthetic.png"));
const input = { branchId, userId: randomUUID(), clientId: 41, requestId: randomUUID(), copaymentReceivedDate: "2026-01-02" };

function arrange() {
    const stored = { objects: new Map<string, Buffer>() };
    const storage = {
        download: jest.fn(async (path: string) => {
            const object = stored.objects.get(path);
            if (!object) throw new FileStorageObjectNotFoundError(path, "download");
            return object;
        }),
        createPrivateObject: jest.fn(),
    };
    const provider = jest.fn();
    const render = jest.fn();
    const branch = { findFirst: jest.fn().mockResolvedValue({ id: branchId }) };
    const client = { findFirst: jest.fn().mockResolvedValue({ id: input.clientId }), update: jest.fn() };
    const jobs = { findFirst: jest.fn().mockResolvedValue(null) };
    const transaction = jest.fn();
    const approval = { ensureApproved: jest.fn().mockResolvedValue(undefined) };
    const hashBirthday = jest.fn().mockReturnValue("synthetic-birthday-hash");
    const loader = new StandaloneReceiptTemplateLoader(storage);
    const service = new StandaloneReceiptIssueService(
        { branch, client, message_trigger_job: jobs, $transaction: transaction } as never,
        approval as never, loader, { hashBirthday } as never,
        { ensureSystemRule: jest.fn() } as never,
    );
    return { service, stored, storage, transaction, approval, client, jobs, provider, render, hashBirthday, loader };
}

function arrangeLockedClient(birthday: string) {
    const f = arrange();
    jest.spyOn(f.loader, "load").mockResolvedValue(fixture);
    f.client.findFirst.mockResolvedValueOnce({ id: input.clientId }).mockResolvedValueOnce({
        id: input.clientId, name: "QA-고객", phone: "01000004121", birthday,
        startDate: new Date("2025-12-01T00:00:00Z"), endDate: new Date("2025-12-31T00:00:00Z"),
        fullPrice: "100000", grant: "70000", actualPrice: "30000", serviceStatus: "completed",
    });
    const insert = jest.fn().mockResolvedValue(1);
    const tx = {
        client: f.client,
        message_trigger_job: f.jobs,
        $queryRaw: jest.fn().mockResolvedValueOnce([{ name: "QA-지점" }]).mockResolvedValueOnce([{ id: input.clientId }]),
        $executeRaw: insert,
    };
    f.transaction.mockImplementation((callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));
    return { ...f, insert, freshInput: { ...input, requestId: randomUUID() } };
}

describe("StandaloneReceiptIssueService fresh-key admission", () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date("2026-01-01T00:00:00Z") }));
    afterEach(() => jest.useRealTimers());

    it.each([
        ["no private artwork", null],
        ["artwork provisioned in a different branch", key(otherBranch)],
        ["wrong digest at the expected key", key(branchId)],
    ])("refuses %s before entering the write transaction", async (_case, provisionedPath) => {
        const f = arrange();
        if (provisionedPath) f.stored.objects.set(provisionedPath, fixture);
        const before = [...f.stored.objects];
        await expect(f.service.issue(input)).rejects.toMatchObject({
            status: 403, response: { code: "ACCESS_DENIED" },
        });
        expect(f.storage.download.mock.calls).toEqual([[key(branchId)]]);
        expect(f.transaction).not.toHaveBeenCalled();
        expect(f.client.update).not.toHaveBeenCalled();
        expect([...f.stored.objects]).toEqual(before);
        expect(f.render).not.toHaveBeenCalled();
        expect(f.storage.createPrivateObject).not.toHaveBeenCalled();
        expect(f.provider).not.toHaveBeenCalled();
    });

    it.each(["2026-02-30", "2026-1-2", "2100-01-01"])("refuses invalid calendar input %s", async date => {
        const f = arrange();
        await expect(f.service.issue({ ...input, copaymentReceivedDate: date })).rejects.toMatchObject({
            status: 400, response: { code: "INVALID_RECEIVED_DATE" },
        });
        expect(f.transaction).not.toHaveBeenCalled();
        expect(f.storage.download).not.toHaveBeenCalled();
    });

    it("checks sender authority and client visibility before reading the request binding", async () => {
        const f = arrange();
        f.approval.ensureApproved.mockRejectedValueOnce(new ForbiddenException());
        await expect(f.service.issue(input)).rejects.toMatchObject({ status: 403 });
        f.client.findFirst.mockResolvedValueOnce(null);
        await expect(f.service.issue(input)).rejects.toMatchObject({ status: 404 });
        expect(f.jobs.findFirst).not.toHaveBeenCalled();
        expect(f.storage.download).not.toHaveBeenCalled();
        expect(f.transaction).not.toHaveBeenCalled();
    });

    it.each([
        ["legacy customer", "940304", "19940304"],
        ["legacy leap day", "280229", "19280229"],
        ["explicit full year", "19940304", "19940304"],
    ])("hashes the canonical birthday for a %s on fresh issuance", async (_case, stored, canonical) => {
        jest.setSystemTime(new Date("2026-11-24T03:00:00Z"));
        const f = arrangeLockedClient(stored);

        await expect(f.service.issue(f.freshInput)).resolves.toMatchObject({ queued: true });

        expect(f.hashBirthday).toHaveBeenCalledTimes(1);
        expect(f.hashBirthday).toHaveBeenCalledWith(canonical);
        expect(f.insert).toHaveBeenCalledTimes(1);
        expect(f.client.update).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["future day this year", "261125", "2026-11-24T03:00:00Z"],
        ["invalid calendar date", "940230", "2026-11-24T03:00:00Z"],
        ["invalid raw spacing", "9403 04", "2026-11-24T03:00:00Z"],
        ["future leap day after the century pivot changes", "280229", "2028-01-15T03:00:00Z"],
    ])("refuses a %s before hashing or writing", async (_case, stored, now) => {
        jest.setSystemTime(new Date(now));
        const f = arrangeLockedClient(stored);

        await expect(f.service.issue(f.freshInput)).rejects.toMatchObject({
            status: 400, response: { code: "MISSING_RECEIPT_FIELDS" },
        });

        expect(f.hashBirthday).not.toHaveBeenCalled();
        expect(f.insert).not.toHaveBeenCalled();
        expect(f.client.update).not.toHaveBeenCalled();
    });
});
