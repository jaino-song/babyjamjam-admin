import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { ActionCoordinatorService } from "application/agent/action-coordinator.service";
import { AgentFlagsService } from "application/agent/agent-flags.service";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";

import { AgentActionController } from "./agent-action.controller";

const tenant = Object.freeze({ userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin" });

describe("AgentActionController client surface", () => {
    it.each([undefined, "mobile", "desktop", ["mobile"]])("passes header %j to approve, reject and reconcile without mutating tenant", async (header) => {
        const actions = {
            approve: jest.fn().mockResolvedValue({ action: {} }), reject: jest.fn().mockResolvedValue({}),
            reconcile: jest.fn().mockResolvedValue({}), publicAction: jest.fn().mockReturnValue({}),
        };
        const controller = new AgentActionController(actions as never);
        const request = { tenant, headers: header === undefined ? {} : { "x-bjj-client": header } } as never;
        await controller.approve("a", { expectedRevision: "r" }, request);
        await controller.reject("a", {}, request);
        await controller.reconcile("a", request);
        for (const method of [actions.approve, actions.reject, actions.reconcile]) {
            const passed = method.mock.calls[0][1];
            expect(passed).toEqual({ ...tenant, ...(header === "mobile" ? { clientSurface: "mobile" } : {}) });
            expect(passed).not.toBe(tenant);
        }
        expect(tenant).not.toHaveProperty("clientSurface");
    });

    it("refuses a mobile correction approval with the ACCESS_DENIED problem before any write", async () => {
        const flags = new AgentFlagsService(new ConfigService({ NODE_ENV: "development", AGENT_WRITE_ENABLED: "true" }),
            { execute: jest.fn().mockResolvedValue(null) } as never, {} as never);
        const gate = jest.spyOn(flags, "isCapabilityEnabled");
        const execute = jest.fn();
        const meta = { name: "service-records.edit", domain: "service-records", version: "1", risk: "reversible-write", requiredRoles: ["admin"] };
        const writes = { updateMany: jest.fn() };
        const coordinator = new ActionCoordinatorService({ agent_action: writes } as never,
            { get: () => ({ meta, execute }) } as never, flags, {} as never, {} as never, {} as never, {} as never);
        jest.spyOn(coordinator, "get").mockResolvedValue({
            id: "a", status: "proposed", capability: meta.name, capabilityVersion: "1", proposalRevision: "r",
            expiresAt: new Date("2099-01-01"), targetVersion: null, proposal: {},
        } as never);
        const controller = new AgentActionController(coordinator);
        const pending = controller.approve("a", { expectedRevision: "r" }, { tenant, headers: { "x-bjj-client": "mobile" } } as never);
        const error = await pending.catch((reason: unknown) => reason);
        expect(gate).toHaveBeenCalledWith(meta, { ...tenant, clientSurface: "mobile" });
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(error).toMatchObject({ response: codeOnlyProblemBody("ACCESS_DENIED") });
        expect(writes.updateMany).not.toHaveBeenCalled();
        expect(execute).not.toHaveBeenCalled();
    });
});
