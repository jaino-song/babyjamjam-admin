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
    const service = new StandaloneReceiptIssueService(
        { branch, client, message_trigger_job: jobs, $transaction: transaction } as never,
        approval as never, new StandaloneReceiptTemplateLoader(storage), {} as never, {} as never,
    );
    return { service, stored, storage, transaction, approval, client, jobs, provider, render };
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
});
