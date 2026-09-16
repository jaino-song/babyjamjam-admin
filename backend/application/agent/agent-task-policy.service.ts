import { ForbiddenException, Injectable } from "@nestjs/common";

import type { AgentCapabilityMeta } from "@babyjamjam/shared";

import { AgentFlagsService } from "application/agent/agent-flags.service";
import { CapabilityRegistryService } from "application/agent/capability-registry.service";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";

/** Preserve the exact role rule used by AgentFlagsService for task writes. */
export function agentTaskRoleMatchesCapability(
    capability: Pick<AgentCapabilityMeta, "requiredRoles">,
    principal: Pick<VerifiedTenantPrincipal, "globalRole" | "branchRole">,
): boolean {
    return principal.globalRole === "owner"
        ? capability.requiredRoles.includes("owner")
        : capability.requiredRoles.includes(principal.branchRole);
}

@Injectable()
export class AgentTaskPolicyService {
    constructor(
        private readonly flags: AgentFlagsService,
        private readonly registry: CapabilityRegistryService,
    ) {}

    capability(capabilityId: string): AgentCapabilityMeta {
        return this.registry.get(capabilityId).meta;
    }

    async assertCanCreate(
        principal: VerifiedTenantPrincipal,
        capabilityId: string,
    ): Promise<AgentCapabilityMeta> {
        const capability = this.capability(capabilityId);
        const snapshot = await this.flags.getSnapshot();
        const enabled = this.flags.isCapabilityEnabledFromSnapshot(capability, principal, snapshot);
        if (
            !enabled
            || snapshot.config.capabilities["conversation.tasks"] !== true
        ) {
            throw new ForbiddenException("Agent task creation unavailable");
        }
        return capability;
    }

    /** Draft-only edits retain reachability during operational flag rollback. */
    assertCanPatch(
        principal: VerifiedTenantPrincipal,
        capabilityId: string,
    ): AgentCapabilityMeta {
        const capability = this.capability(capabilityId);
        if (!agentTaskRoleMatchesCapability(capability, principal)) {
            throw new ForbiddenException("Agent task edit unavailable");
        }
        return capability;
    }

    /**
     * Preparing a review is the rollout-gated lifecycle transition.  The
     * ordinary draft command rules stay available to an authorized role even
     * while the conversation task feature is rolled back.
     */
    async assertCanPrepareReview(
        principal: VerifiedTenantPrincipal,
        capabilityId: string,
    ): Promise<AgentCapabilityMeta> {
        const capability = this.capability(capabilityId);
        const snapshot = await this.flags.getSnapshot();
        if (
            snapshot.config.capabilities["conversation.tasks"] !== true
            || !this.flags.isCapabilityEnabledFromSnapshot(capability, principal, snapshot)
        ) {
            throw new ForbiddenException("Agent task review preparation unavailable");
        }
        return capability;
    }
}
