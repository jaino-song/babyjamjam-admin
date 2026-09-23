import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ListEmployeeSchedulesUsecase } from "./list-employee-schedules.usecase";

// Legacy data includes employee id 0, so employee ids are non-negative.
const ScheduleSchema = z.object({ id: z.number().int().positive(), clientId: z.number().int().positive(), primaryEmployeeId: z.number().int().nonnegative(), secondaryEmployeeId: z.number().int().nonnegative().nullable(), startDate: z.string(), endDate: z.string(), replaced: z.boolean() });
const InputSchema = z.object({
    date: z.string().date().optional().describe(
        "Optional ISO date (YYYY-MM-DD). When given, only schedules overlapping that date are returned; omit to list all current/upcoming schedules."
    ),
});
const OutputSchema = z.object({ schedules: z.array(ScheduleSchema) });

@Injectable()
@AgentCapabilityProvider()
export class EmployeeScheduleAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly listSchedules: ListEmployeeSchedulesUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: { name: "schedules.list", domain: "schedules", version: "1.0.0", description: "List employee work schedules (client assignments) for the current branch, optionally filtered to one calendar date. Use for: 오늘 일정, 이번주 스케줄, 방문 일정 확인, 특정 날짜 배정 확인. Input: optional date (YYYY-MM-DD); when given, only schedules overlapping that date are returned, up to 50 rows sorted by start date. Does not accept a client or employee name — cross-reference the returned ids with clients.get or employees.get. Returns: id, clientId, primaryEmployeeId, secondaryEmployeeId, startDate, endDate, replaced.", risk: "read", requiredRoles: ["owner", "admin", "manager", "user"], renderer: "activity", flagKey: "agent.capability.schedules.list", sideEffect: false },
            inputSchema: InputSchema, outputSchema: OutputSchema,
            execute: async (context, rawInput) => {
                const { date } = InputSchema.parse(rawInput);
                const schedules = await this.listSchedules.execute(context.principal.branchId);
                const dayStart = date ? new Date(`${date}T00:00:00.000Z`) : null;
                const dayEnd = date ? new Date(`${date}T23:59:59.999Z`) : null;
                const filteredSchedules = schedules.filter((schedule) => (
                    !dayStart || !dayEnd || (schedule.startDate <= dayEnd && schedule.endDate >= dayStart)
                ));
                filteredSchedules.sort((left, right) => {
                    const startDateOrder = left.startDate.getTime() - right.startDate.getTime();
                    if (startDateOrder !== 0) return startDateOrder;
                    const endDateOrder = left.endDate.getTime() - right.endDate.getTime();
                    return endDateOrder !== 0 ? endDateOrder : left.id - right.id;
                });
                return { schedules: filteredSchedules.slice(0, 50).map((schedule) => ({ id: schedule.id, clientId: schedule.clientId, primaryEmployeeId: schedule.primaryEmployeeId, secondaryEmployeeId: schedule.secondaryEmployeeId, startDate: schedule.startDate.toISOString(), endDate: schedule.endDate.toISOString(), replaced: schedule.replaced })) };
            },
        }];
    }
}
