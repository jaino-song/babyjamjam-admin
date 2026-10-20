import { ContractExternalAgentCapabilitiesProvider } from "application/usecases/eformsign-doc/contract-external-agent-capabilities.provider";

async function reconcileAt(statusType: string) {
    const provider = new ContractExternalAgentCapabilitiesProvider(
        { execute: jest.fn().mockRejectedValue(new Error("Unexpected send")) } as never,
        { execute: jest.fn().mockResolvedValue({}) } as never,
        {
            withCredentials: jest.fn(async (_principal: unknown, _capability: string, operation: (credentials: { accessToken: string }) => unknown) =>
                operation({ accessToken: "token" })),
        } as never,
        {
            execute: jest.fn().mockResolvedValue({
                current_status: { status_type: statusType, status_doc_detail: "detail" },
            }),
        } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
    );
    const capability = provider.getCapabilities()[0]!;
    return capability.reconcile!(
        { principal: { branchId: "branch-1" }, sessionId: "session", actionId: "action" } as never,
        { clientId: 7, templateId: "template-1" },
        { remoteDocumentId: "doc-1" },
    );
}

describe("contract dispatch reconciliation by provider status", () => {
    it("confirms a dispatched contract at 041 (a refused revoke) exactly like 060", async () => {
        const at060 = await reconcileAt("060");
        const at041 = await reconcileAt("041");

        expect(at060.status).toBe("succeeded");
        expect(at041).toEqual(at060);
    });

    it.each(["040", "045"])("does not prove dispatch at %s (revoke requested)", async (statusType) => {
        await expect(reconcileAt(statusType)).resolves.toMatchObject({ status: "uncertain" });
    });

    it("reports a revoked 042 document as failed", async () => {
        await expect(reconcileAt("042")).resolves.toMatchObject({ status: "failed" });
    });
});
