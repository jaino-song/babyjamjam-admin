import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { GetClientDashboardSummaryUsecase } from "./get-client-dashboard-summary.usecase";

const InputSchema = z.object({}).default({});
const OutputSchema = z.object({
    totalClients: z.number().int().nonnegative(),
    activeClients: z.number().int().nonnegative(),
});

@Injectable()
@AgentCapabilityProvider()
export class DashboardAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly getSummary: GetClientDashboardSummaryUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: {
                name: "dashboard.summary",
                domain: "dashboard",
                version: "1.0.0",
                description: "Give a quick headline count of clients in the current branch, without exposing any personal contact data. Use for: 전체 산모 수, 진행중인 고객 수, 대시보드 요약. Input: none. Returns: totalClients, activeClients. For a breakdown by service status, use analytics.summary instead.",
                risk: "read",
                requiredRoles: ["owner", "admin", "manager", "user"],
                renderer: "activity",
                flagKey: "agent.capability.dashboard.summary",
                sideEffect: false,
            },
            inputSchema: InputSchema,
            outputSchema: OutputSchema,
            execute: async (context, rawInput) => {
                InputSchema.parse(rawInput);
                return OutputSchema.parse(await this.getSummary.execute(context.principal.branchId));
            },
        }];
    }
}
