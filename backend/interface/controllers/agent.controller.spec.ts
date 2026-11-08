import { AgentController } from "./agent.controller";

describe("AgentController emergency disable", () => {
    it("sends only the enabled=false patch so stored domains, capabilities, and risks survive", async () => {
        const flags = {
            getConfig: jest.fn(),
            updateConfig: jest.fn().mockResolvedValue({ enabled: false }),
        };
        const controller = new AgentController(
            {} as never,
            {} as never,
            {} as never,
            flags as never,
            {} as never,
            {} as never,
        );

        await expect(controller.emergencyDisable()).resolves.toEqual({ enabled: false });
        expect(flags.getConfig).not.toHaveBeenCalled();
        expect(flags.updateConfig).toHaveBeenCalledWith({ enabled: false });
    });
});

describe("AgentController task restore composition", () => {
    it("adds server-derived task restore fields after the owned session succeeds", async () => {
        const sessions = {
            get: jest.fn(),
            getForRestore: jest.fn().mockResolvedValue({ id: "session-1", messages: [] }),
        };
        const tasks = {
            restoreSession: jest.fn().mockResolvedValue({
                activeTaskId: "task-1",
                pausedTaskIds: ["task-2"],
                taskRestoreStatus: "available",
                recoveryTaskIds: [],
            }),
        };
        const controller = new AgentController(
            {} as never,
            sessions as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            undefined,
            undefined,
            undefined,
            undefined,
            tasks as never,
        );
        const response = { setHeader: jest.fn() };
        const tenant = { userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "manager" };

        await expect(controller.get("session-1", { tenant } as never, response as never)).resolves.toEqual({
            id: "session-1",
            messages: [],
            activeTaskId: "task-1",
            pausedTaskIds: ["task-2"],
            taskRestoreStatus: "available",
            recoveryTaskIds: [],
        });
        expect(sessions.getForRestore).toHaveBeenCalledWith("session-1", { userId: "user-1", branchId: "branch-1" });
        expect(sessions.get).not.toHaveBeenCalled();
        expect(tasks.restoreSession).toHaveBeenCalledWith(tenant, "session-1");
        expect(response.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    });
});


describe("AgentController client surface", () => {
    it.each([undefined, "mobile", "desktop"])("passes request header %s to the capability gate without mutating tenant", async (header) => {
        const tenant = Object.freeze({ userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin" });
        const flags = { getSnapshot: jest.fn().mockResolvedValue({}), isCapabilityEnabledFromSnapshot: jest.fn().mockReturnValue(true) };
        const controller = new AgentController({} as never, {} as never, { list: () => [{ meta: { name: "clients.update" } }] } as never, flags as never, {} as never, {} as never);
        await controller.capabilities({ tenant, headers: header === undefined ? {} : { "x-bjj-client": header } } as never);
        const passed = flags.isCapabilityEnabledFromSnapshot.mock.calls[0][1];
        expect(passed).toEqual({ ...tenant, ...(header === "mobile" ? { clientSurface: "mobile" } : {}) });
        expect(passed).not.toBe(tenant);
        expect(tenant).not.toHaveProperty("clientSurface");
    });
});
