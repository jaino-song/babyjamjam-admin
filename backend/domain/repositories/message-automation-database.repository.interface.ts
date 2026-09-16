import type { Prisma } from "@prisma/client";

/**
 * Database port used by the branch-scoped message automation aggregate.
 *
 * The application layer needs the transaction client shape for its ordered
 * row locks, while only the infrastructure module binds the concrete Prisma
 * service. Keeping the runner on this port prevents new automation services
 * from importing the infrastructure Prisma class directly.
 */
export interface MessageAutomationDatabase extends Prisma.TransactionClient {
    $transaction<T>(
        callback: (transaction: Prisma.TransactionClient) => Promise<T>,
        options?: {
            maxWait?: number;
            timeout?: number;
            isolationLevel?: Prisma.TransactionIsolationLevel;
        },
    ): Promise<T>;
}

export const MESSAGE_AUTOMATION_DATABASE = "MESSAGE_AUTOMATION_DATABASE";
