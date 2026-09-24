import { Test } from "@nestjs/testing";

import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { EMPLOYEE_REPOSITORY } from "domain/repositories/employee.repository.interface";
import { EmployeeScheduleAgentCapabilitiesProvider } from "./employee-schedule-agent-capabilities.provider";
import { ListEmployeeSchedulesUsecase } from "./list-employee-schedules.usecase";

/**
 * DI-graph gate for BJJ audit finding #3: `CLIENT_REPOSITORY`/`EMPLOYEE_REPOSITORY` used to be
 * injected with `@Optional()`, so if `EmployeeScheduleModule` ever stopped providing either
 * token the provider would silently construct with `undefined` and `schedules.list` would
 * quietly resolve every client/employee name to null — nothing would fail. Making the
 * injection required turns that into a hard compile-time DI error; this spec proves both
 * directions without needing a live database (same reasoning as
 * test/unit/scheduler-lease.module.spec.ts — `.compile()` alone does not run Nest lifecycle
 * hooks, so mocked-adapter providers are enough).
 */
describe("EmployeeScheduleAgentCapabilitiesProvider — DI graph", () => {
    it("resolves from the compiled module graph when both repository tokens are provided", async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                EmployeeScheduleAgentCapabilitiesProvider,
                { provide: ListEmployeeSchedulesUsecase, useValue: { execute: jest.fn() } },
                { provide: CLIENT_REPOSITORY, useValue: { findNamesByIds: jest.fn() } },
                { provide: EMPLOYEE_REPOSITORY, useValue: { findNamesByIds: jest.fn() } },
            ],
        }).compile();

        try {
            const provider = moduleRef.get(EmployeeScheduleAgentCapabilitiesProvider);
            expect(provider).toBeInstanceOf(EmployeeScheduleAgentCapabilitiesProvider);
        } finally {
            await moduleRef.close();
        }
    });

    it("fails to compile when CLIENT_REPOSITORY is not provided, proving the injection is required", async () => {
        await expect(Test.createTestingModule({
            providers: [
                EmployeeScheduleAgentCapabilitiesProvider,
                { provide: ListEmployeeSchedulesUsecase, useValue: { execute: jest.fn() } },
                { provide: EMPLOYEE_REPOSITORY, useValue: { findNamesByIds: jest.fn() } },
            ],
        }).compile()).rejects.toThrow();
    });

    it("fails to compile when EMPLOYEE_REPOSITORY is not provided, proving the injection is required", async () => {
        await expect(Test.createTestingModule({
            providers: [
                EmployeeScheduleAgentCapabilitiesProvider,
                { provide: ListEmployeeSchedulesUsecase, useValue: { execute: jest.fn() } },
                { provide: CLIENT_REPOSITORY, useValue: { findNamesByIds: jest.fn() } },
            ],
        }).compile()).rejects.toThrow();
    });
});
