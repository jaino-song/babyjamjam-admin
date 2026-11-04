import { Injectable } from "@nestjs/common";
import { MessageTriggerService, type MessageTriggerRuleGroupDraft } from "./message-trigger.service";

/** Public group facade. All writers share the existing trigger core and locks. */
@Injectable()
export class MessageTriggerRuleGroupService {
    constructor(private readonly triggers: MessageTriggerService) {}

    list(branchId: string) { return this.triggers.listRuleGroups(branchId); }
    get(branchId: string, id: string) { return this.triggers.getRuleGroup(branchId, id); }
    create(branchId: string, draft: MessageTriggerRuleGroupDraft) { return this.triggers.createRuleGroup(branchId, draft); }
    update(branchId: string, id: string, draft: MessageTriggerRuleGroupDraft & { expectedVersion: number }) { return this.triggers.updateRuleGroup(branchId, id, draft); }
    delete(branchId: string, id: string) { return this.triggers.deleteRuleGroup(branchId, id); }
}
