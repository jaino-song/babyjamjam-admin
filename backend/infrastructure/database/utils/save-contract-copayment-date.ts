import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

import { codeOnlyProblemBody } from "application/utils/problem-bodies";

/** Called inside the acceptance transaction while it holds the client row lock. */
export async function saveContractCopaymentDate(
    tx: Prisma.TransactionClient,
    branchId: string,
    clientId: number,
    copaymentReceivedDate: Date,
): Promise<void> {
    const result = await tx.client.updateMany({
        where: { id: clientId, branchId, deletedAt: null },
        data: { copaymentReceivedDate },
    });
    if (result.count !== 1) throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
}
