import type { Prisma } from "@prisma/client";
import type { AgentAutomationDeliveryGateService, AutomationDeliveryFence } from "../../application/services/agent-automation-delivery-gate.service";

type TestFence = (tx: Prisma.TransactionClient) => Promise<AutomationDeliveryFence>;

/**
 * Explicit admission double for pre-existing delivery/source-fence unit tests.
 * These suites test their original owner, not authority issuance. Real admission,
 * bypass, rollback and single-use behavior has separate gate and DB coverage.
 */
export function createLegacyAutomationDeliveryGate(database?: unknown, lock?: unknown): AgentAutomationDeliveryGateService {
    const run = async (job: { branchId: string }, callback: TestFence) => {
        if (lock) return (lock as { runExclusive: (branchId: string, callback: TestFence) => Promise<AutomationDeliveryFence> }).runExclusive(job.branchId, callback);
        return (database as { $transaction: (callback: TestFence) => Promise<AutomationDeliveryFence> }).$transaction(callback);
    };
    return {
        bindMaterialization: jest.fn(async () => {}),
        permitsDirectManualJob: jest.fn(async () => true),
        consumePreparation: jest.fn(async () => true),
        consumeDispatch: jest.fn(async () => {}),
        authorizePreparation: jest.fn(async (job, _render, fence) => run(job, fence)),
        authorizeDispatch: jest.fn(async (job, _preparation, _render, fence) => run(job, fence)),
    } as unknown as AgentAutomationDeliveryGateService;
}
