import { EformsignAgentCapabilitiesProvider } from "./eformsign-agent-capabilities.provider";

const context = {
    principal: { userId: "user-a", branchId: "branch-a", globalRole: "admin", branchRole: "admin" },
    sessionId: "session-a", traceId: "trace-a", locale: "ko",
};

function recentDoc({
    documentId = "doc-1",
    documentName = "계약서",
    clientId = 10,
    clientName = "산모",
    statusType = "050",
    statusDetail = "완료",
    stepType = "05",
    stepName = "이용자",
    updatedDate = new Date("2026-09-20T00:00:00.000Z"),
    expired = false,
}: Partial<{
    documentId: string;
    documentName: string | null;
    clientId: number | null;
    clientName: string | null;
    statusType: string;
    statusDetail: string;
    stepType: string;
    stepName: string;
    updatedDate: Date;
    expired: boolean;
}> = {}) {
    // Default *parameters* (not `??`) so an explicit `null` override (e.g. an
    // unassigned document) is not mistaken for "not provided".
    return { documentId, documentName, clientId, clientName, statusType, statusDetail, stepType, stepName, updatedDate, expired };
}

describe("EformsignAgentCapabilitiesProvider — contracts.recent", () => {
    function setup(docs: ReturnType<typeof recentDoc>[]) {
        const findDocs = { execute: jest.fn() };
        const findRecentContracts = { execute: jest.fn().mockResolvedValue(docs) };
        const provider = new EformsignAgentCapabilitiesProvider(findDocs as never, findRecentContracts as never);
        const capability = provider.getCapabilities().find((entry) => entry.meta.name === "contracts.recent")!;
        return { findRecentContracts, capability };
    }

    it("requests the plain limit as the take when no status filter is given", async () => {
        const { findRecentContracts, capability } = setup([recentDoc()]);

        await capability.execute(context, { limit: 5 });

        expect(findRecentContracts.execute).toHaveBeenCalledWith("branch-a", 5);
    });

    it("defaults limit to 10 when omitted", async () => {
        const { findRecentContracts, capability } = setup([]);

        await capability.execute(context, {});

        expect(findRecentContracts.execute).toHaveBeenCalledWith("branch-a", 10);
    });

    it("requests a bounded larger window when a status filter is given, then applies the limit after filtering", async () => {
        const { findRecentContracts, capability } = setup([]);

        await capability.execute(context, { limit: 3, status: "completed" });

        expect(findRecentContracts.execute).toHaveBeenCalledWith("branch-a", 200);
    });

    it("resolves the display status via the shared classifier and never leaks the raw eformsign status code", async () => {
        const { capability } = setup([recentDoc({ statusType: "050", statusDetail: "완료" })]);

        const output = await capability.execute(context, {}) as { documents: Array<Record<string, unknown>> };

        expect(output.documents).toEqual([expect.objectContaining({ status: "completed" })]);
        expect(JSON.stringify(output)).not.toContain('"050"');
    });

    it("filters by the requested display status before applying the limit", async () => {
        const completed = recentDoc({ documentId: "doc-completed", statusType: "050" });
        const pending = recentDoc({ documentId: "doc-pending", statusType: "060", statusDetail: "대기", stepType: "05" });
        const { capability } = setup([completed, pending]);

        const output = await capability.execute(context, { status: "completed" }) as { documents: Array<{ documentId: string }> };

        expect(output.documents.map((doc) => doc.documentId)).toEqual(["doc-completed"]);
    });

    it("passes through the joined client name without a follow-up lookup", async () => {
        const { capability } = setup([recentDoc({ clientId: 42, clientName: "홍길동" })]);

        const output = await capability.execute(context, {}) as { documents: Array<{ clientId: number; clientName: string }> };

        expect(output.documents[0]).toMatchObject({ clientId: 42, clientName: "홍길동" });
    });

    it("passes through a null client for an unassigned document without throwing", async () => {
        const { capability } = setup([recentDoc({ clientId: null, clientName: null })]);

        const output = await capability.execute(context, {}) as { documents: Array<{ clientId: number | null; clientName: string | null }> };

        expect(output.documents[0]).toMatchObject({ clientId: null, clientName: null });
    });
});
