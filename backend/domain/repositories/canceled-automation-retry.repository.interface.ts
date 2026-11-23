import type { Prisma } from "@prisma/client";

export interface CanceledRetryRule {
    id: string;
    branchId: string | null;
    name: string;
    isActive: boolean;
    templateKey: string;
    recipientType: string;
    canceledRetryEnabledAt: Date | null;
    branchOverrides: Array<{ isActive: boolean; canceledRetryEnabledAt: Date | null }>;
}

export interface ICanceledAutomationRetryRepository {
    list(branchId: string): Promise<CanceledRetryRule[]>;
    lockRule(branchId: string, id: string, transaction: Prisma.TransactionClient): Promise<CanceledRetryRule | null>;
    updateEpoch(transaction: Prisma.TransactionClient, branchId: string, rule: CanceledRetryRule, enabled: boolean): Promise<Date | null>;
}

export const CANCELED_AUTOMATION_RETRY_REPOSITORY = Symbol("CANCELED_AUTOMATION_RETRY_REPOSITORY");
