import { DiscoveryService } from "@nestjs/core";
import { z } from "zod";

import { AgentCapabilityProvider } from "./capability.decorator";
import { CapabilityRegistryService } from "./capability-registry.service";
import type { AgentCapabilityProviderContract } from "./capability.types";
import { ClientAgentCapabilitiesProvider } from "application/usecases/client/client-agent-capabilities.provider";

const definition = {
    meta: {
        name: "clients.search",
        domain: "clients",
        version: "1.0.0",
        description: "Search clients",
        risk: "read" as const,
        requiredRoles: ["owner", "admin", "user"],
        renderer: "entity-choice" as const,
        flagKey: "agent.capability.clients.search.enabled",
        sideEffect: false,
    },
    inputSchema: z.object({ search: z.string() }),
    outputSchema: z.object({ clients: z.array(z.unknown()) }),
    execute: jest.fn(),
};

describe("CapabilityRegistryService", () => {
    it("should discover decorated capability providers", () => {
        const provider: AgentCapabilityProviderContract = {
            getCapabilities: () => [definition],
        };
        const wrapper = { instance: provider };
        const discovery = {
            getProviders: jest.fn().mockReturnValue([wrapper]),
            getMetadataByDecorator: jest.fn().mockReturnValue(undefined),
        } as unknown as DiscoveryService;
        jest.spyOn(discovery, "getMetadataByDecorator").mockReturnValue(undefined);
        (discovery.getMetadataByDecorator as jest.Mock).mockImplementation((decorator) => (
            decorator === AgentCapabilityProvider ? undefined : undefined
        ));
        jest.spyOn(discovery, "getProviders").mockReturnValue([wrapper] as never);

        const registry = new CapabilityRegistryService(discovery);
        registry.registerProviders([provider]);

        expect(registry.get("clients.search").meta.version).toBe("1.0.0");
    });

    it("should fail closed when capability names are duplicated", () => {
        const provider: AgentCapabilityProviderContract = {
            getCapabilities: () => [definition, definition],
        };
        const discovery = {} as DiscoveryService;
        const registry = new CapabilityRegistryService(discovery);

        expect(() => registry.registerProviders([provider])).toThrow("Duplicate agent capability: clients.search");
    });

    it("should fail closed for an unknown capability", () => {
        const registry = new CapabilityRegistryService({} as DiscoveryService);

        expect(() => registry.get("clients.missing")).toThrow("Unknown agent capability: clients.missing");
    });

    it("rejects a side-effect capability without restart-safe reconciliation", () => {
        const write = {
            ...definition,
            meta: {
                ...definition.meta,
                name: "clients.update",
                risk: "reversible-write" as const,
                sideEffect: true,
                renderer: "action-proposal" as const,
                approvalPolicy: "structured" as const,
                idempotencyPolicy: "action-id" as const,
            },
        };
        const registry = new CapabilityRegistryService({} as DiscoveryService);

        expect(() => registry.registerProviders([{ getCapabilities: () => [write] }])).toThrow("restart-safe reconciliation");
    });

    it("serves the catalog's sharpened description for a real read capability at runtime", () => {
        // Proves that a real provider's registered meta.description is the
        // catalog string an agent tool call actually sees (declared meta is
        // always overridden by CAPABILITY_CATALOG_BY_NAME in
        // registerProviders), not just the provider's own literal.
        const provider = new ClientAgentCapabilitiesProvider(jest.fn() as never, jest.fn() as never);
        const registry = new CapabilityRegistryService({} as DiscoveryService);

        registry.registerProviders([provider]);

        expect(registry.get("clients.search").meta.description).toContain("Use for:");
    });
});
