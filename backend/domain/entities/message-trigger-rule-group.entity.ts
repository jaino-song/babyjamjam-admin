import type { MessageTriggerRecipientType } from "domain/constants/message-trigger-catalog";

/** A group owns UI identity; execution fields remain on its projected children. */
export class MessageTriggerRuleGroupEntity {
    constructor(
        public readonly id: string,
        public readonly branchId: string,
        public name: string,
        public recipientMode: MessageTriggerRecipientType | "BOTH_EMPLOYEES",
        public version: number,
        public createdAt: Date,
        public updatedAt: Date,
        public deletedAt: Date | null = null,
    ) {}
}
