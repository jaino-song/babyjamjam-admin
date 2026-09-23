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

    it("emits a resolvable constructor type for every non-injected parameter of every class provider", () => {
        // Regression guard for the Nest DI metadata defect: an `import type`
        // of a constructor-injected dependency erases its design:paramtypes
        // entry (emitted as bare Function/Object/undefined), which compiles
        // and passes manual instantiation but fails every module boot. This
        // scans the module metadata offline — no Nest module is compiled.
        const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AgentModule) as unknown[];
        expect(Array.isArray(providers)).toBe(true);

        const offenders: string[] = [];
        for (const provider of providers) {
            // Object-style providers ({ provide, useClass|useExisting|useValue|useFactory })
            // resolve through their own token, not from emitted paramtypes.
            if (typeof provider !== "function") {
                continue;
            }

            const paramTypes = (Reflect.getMetadata("design:paramtypes", provider) ?? []) as unknown[];
            const selfDeclared = (Reflect.getMetadata("self:paramtypes", provider) ?? []) as Array<{
                index: number;
                param: unknown;
            }>;
            const injectedIndexes = new Set(selfDeclared.map((entry) => entry.index));

            paramTypes.forEach((emitted, index) => {
                // Explicit @Inject(...) tokens resolve by token, not by type.
                if (injectedIndexes.has(index)) {
                    return;
                }
                const resolvable = typeof emitted === "function" && emitted !== Function && emitted !== Object;
                if (!resolvable) {
                    const emittedLabel = typeof emitted === "function" ? emitted.name : String(emitted);
                    offenders.push(
                        `${provider.name || "<anonymous>"} constructor parameter [${index}] emitted ${emittedLabel}`,
                    );
                }
            });
        }

        expect(offenders).toEqual([]);
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
