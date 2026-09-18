import { MODULE_METADATA } from "@nestjs/common/constants";
import { Test } from "@nestjs/testing";

import { AgentFlagsService } from "application/agent/agent-flags.service";
import { AgentTaskPolicyService } from "application/agent/agent-task-policy.service";
import { AgentTaskService } from "application/agent/agent-task.service";
import { CapabilityRegistryService } from "application/agent/capability-registry.service";
import { AgentTaskController } from "interface/controllers/agent-task.controller";
import { AgentModule } from "./agent.module";
import { AGENT_TASK_REPOSITORY } from "domain/repositories/agent-task.repository.interface";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";

describe("AgentModule task wiring", () => {
    it("registers task service, controller, and scoped repository adapters", () => {
        const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AgentModule) as unknown[];
        const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, AgentModule) as unknown[];

        expect(providers).toContain(AgentTaskService);
        expect(providers).toContain(AgentTaskPolicyService);
        expect(controllers).toContain(AgentTaskController);
        expect(providers).toContainEqual({ provide: AGENT_TASK_REPOSITORY, useClass: PrismaAgentTaskRepository });
        expect(providers).toContainEqual({ provide: CLIENT_REPOSITORY, useClass: SbClientRepository });
    });

    it("resolves the task service and both repository tokens with mocked adapters", async () => {
        const module = await Test.createTestingModule({
            providers: [
                AgentTaskService,
                AgentTaskPolicyService,
                { provide: AGENT_TASK_REPOSITORY, useValue: {} },
                { provide: CLIENT_REPOSITORY, useValue: {} },
                { provide: AgentFlagsService, useValue: {} },
                { provide: CapabilityRegistryService, useValue: {} },
            ],
        }).compile();

        expect(module.get(AgentTaskService)).toBeInstanceOf(AgentTaskService);
        expect(module.get(AGENT_TASK_REPOSITORY)).toEqual({});
        expect(module.get(CLIENT_REPOSITORY)).toEqual({});
    });
});
