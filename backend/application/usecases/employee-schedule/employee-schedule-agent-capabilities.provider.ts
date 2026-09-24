import { Injectable, Inject } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";
import { EMPLOYEE_REPOSITORY, IEmployeeRepository } from "domain/repositories/employee.repository.interface";
import { ListEmployeeSchedulesUsecase } from "./list-employee-schedules.usecase";

// Legacy data includes employee id 0, so employee ids are non-negative.
const ScheduleSchema = z.object({
    id: z.number().int().positive(),
    clientId: z.number().int().positive(),
    clientName: z.string().nullable(),
    primaryEmployeeId: z.number().int().nonnegative(),
    primaryEmployeeName: z.string().nullable(),
    secondaryEmployeeId: z.number().int().nonnegative().nullable(),
    secondaryEmployeeName: z.string().nullable(),
    startDate: z.string(),
    endDate: z.string(),
    replaced: z.boolean(),
});
const InputSchema = z.object({
    date: z.string().date().optional().describe(
        "Optional ISO date (YYYY-MM-DD). When given, only schedules overlapping that date are returned; omit to list all current/upcoming schedules."
    ),
    clientId: z.number().int().positive().optional().describe("Optional client id — only schedules for this client are returned."),
    employeeId: z.number().int().nonnegative().optional().describe("Optional employee id — only schedules where this employee is primary or secondary are returned."),
});
const OutputSchema = z.object({ schedules: z.array(ScheduleSchema) });

@Injectable()
@AgentCapabilityProvider()
export class EmployeeScheduleAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(
        private readonly listSchedules: ListEmployeeSchedulesUsecase,
        @Inject(CLIENT_REPOSITORY) private readonly clientRepository: IClientRepository,
        @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: IEmployeeRepository,
    ) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: { name: "schedules.list", domain: "schedules", version: "1.0.0", description: "List employee work schedules (client assignments) for the current branch, optionally filtered to one calendar date, client, or employee. Use for: 오늘 일정, 이번주 스케줄, 방문 일정 확인, 특정 날짜 배정 확인. Input: optional date (YYYY-MM-DD; when given, only schedules overlapping that date are returned), optional clientId, optional employeeId (matches primary or secondary) — up to 50 rows sorted by start date. Returns: id, clientId, clientName, primaryEmployeeId, primaryEmployeeName, secondaryEmployeeId, secondaryEmployeeName, startDate, endDate, replaced. Names resolve even for a soft-deleted client or employee so history stays readable.", risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "activity", flagKey: "agent.capability.schedules.list", sideEffect: false },
            inputSchema: InputSchema, outputSchema: OutputSchema,
            execute: async (context, rawInput) => {
                const { date, clientId, employeeId } = InputSchema.parse(rawInput);
                const schedules = await this.listSchedules.execute(context.principal.branchId);
                const dayStart = date ? new Date(`${date}T00:00:00.000Z`) : null;
                const dayEnd = date ? new Date(`${date}T23:59:59.999Z`) : null;
                const filteredSchedules = schedules.filter((schedule) => (
                    (!dayStart || !dayEnd || (schedule.startDate <= dayEnd && schedule.endDate >= dayStart))
                    && (clientId === undefined || schedule.clientId === clientId)
                    && (employeeId === undefined || schedule.primaryEmployeeId === employeeId || schedule.secondaryEmployeeId === employeeId)
                ));
                filteredSchedules.sort((left, right) => {
                    const startDateOrder = left.startDate.getTime() - right.startDate.getTime();
                    if (startDateOrder !== 0) return startDateOrder;
                    const endDateOrder = left.endDate.getTime() - right.endDate.getTime();
                    return endDateOrder !== 0 ? endDateOrder : left.id - right.id;
                });
                const limited = filteredSchedules.slice(0, 50);

                const clientIds = [...new Set(limited.map((schedule) => schedule.clientId))];
                const employeeIds = [...new Set(limited.flatMap((schedule) => (
                    schedule.secondaryEmployeeId != null
                        ? [schedule.primaryEmployeeId, schedule.secondaryEmployeeId]
                        : [schedule.primaryEmployeeId]
                )))];
                const [clientNames, employeeNames] = await Promise.all([
                    this.clientRepository.findNamesByIds(context.principal.branchId, clientIds),
                    this.employeeRepository.findNamesByIds(context.principal.branchId, employeeIds),
                ]);
                const clientNameById = new Map(clientNames.map(({ id, name }) => [id, name]));
                const employeeNameById = new Map(employeeNames.map(({ id, name }) => [id, name]));

                return {
                    schedules: limited.map((schedule) => ({
                        id: schedule.id,
                        clientId: schedule.clientId,
                        clientName: clientNameById.get(schedule.clientId) ?? null,
                        primaryEmployeeId: schedule.primaryEmployeeId,
                        primaryEmployeeName: employeeNameById.get(schedule.primaryEmployeeId) ?? null,
                        secondaryEmployeeId: schedule.secondaryEmployeeId,
                        secondaryEmployeeName: schedule.secondaryEmployeeId != null
                            ? employeeNameById.get(schedule.secondaryEmployeeId) ?? null
                            : null,
                        startDate: schedule.startDate.toISOString(),
                        endDate: schedule.endDate.toISOString(),
                        replaced: schedule.replaced,
                    })),
                };
            },
        }];
    }
}
