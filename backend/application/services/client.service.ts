import { Injectable } from "@nestjs/common";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { ClientEntity } from "domain/entities/client.entity";
import { PaginatedResult } from "domain/repositories/client.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class ClientService {
    constructor(
        private readonly createClientUsecase: CreateClientUsecase,
        private readonly findClientByIdUsecase: FindClientByIdUsecase,
        private readonly listClientsUsecase: ListClientsUsecase,
        private readonly listClientsPaginatedUsecase: ListClientsPaginatedUsecase,
        private readonly updateClientUsecase: UpdateClientUsecase,
        private readonly deleteClientUsecase: DeleteClientUsecase,
        private readonly prismaService: PrismaService,
    ) {}

    async create(params: {
        name: string;
        primaryEmployeeId: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter: boolean;
        voucherClient: boolean;
        birthday?: string | null;
        contractStatus?: string | null;
        breastPump: boolean;
    }): Promise<ClientEntity> {
        // Create employee_schedule for primary employee
        const startDate = params.startDate ? new Date(params.startDate) : new Date();
        const endDate = params.endDate ? new Date(params.endDate) : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000); // Default to 1 year

        const primarySchedule = await this.prismaService.employee_schedule.create({
            data: {
                employee_id: params.primaryEmployeeId,
                work_address: params.address ?? "",
                start_date: startDate,
                end_date: endDate,
                replaced: false,
            },
        });

        // Create employee_schedule for secondary employee if provided
        let secondaryScheduleId: number | null = null;
        if (params.secondaryEmployeeId !== null && params.secondaryEmployeeId !== undefined) {
            const secondarySchedule = await this.prismaService.employee_schedule.create({
                data: {
                    employee_id: params.secondaryEmployeeId,
                    work_address: params.address ?? "",
                    start_date: startDate,
                    end_date: endDate,
                    replaced: false,
                },
            });
            secondaryScheduleId = secondarySchedule.id;
        }

        return this.createClientUsecase.execute({
            name: params.name,
            primaryScheduleId: primarySchedule.id,
            secondaryScheduleId: secondaryScheduleId,
            address: params.address ?? null,
            phone: params.phone ?? null,
            type: params.type ?? null,
            duration: params.duration ?? null,
            fullPrice: params.fullPrice ?? null,
            grant: params.grant ?? null,
            actualPrice: params.actualPrice ?? null,
            startDate: params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate ? new Date(params.endDate) : null,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
            birthday: params.birthday ?? null,
            contractStatus: params.contractStatus ?? null,
            breastPump: params.breastPump,
        });
    }

    findAll(): Promise<ClientEntity[]> {
        return this.listClientsUsecase.execute();
    }

    findAllPaginated(page: number, limit: number, search?: string): Promise<PaginatedResult<ClientEntity>> {
        return this.listClientsPaginatedUsecase.execute(page, limit, search);
    }

    findById(id: number): Promise<ClientEntity | null> {
        return this.findClientByIdUsecase.execute(id);
    }

    async update(id: number, params: {
        name?: string;
        primaryEmployeeId?: number;
        secondaryEmployeeId?: number | null;
        address?: string | null;
        phone?: string | null;
        type?: string | null;
        duration?: number | null;
        fullPrice?: string | null;
        grant?: string | null;
        actualPrice?: string | null;
        startDate?: string | null;
        endDate?: string | null;
        careCenter?: boolean;
        voucherClient?: boolean;
        birthday?: string | null;
        contractStatus?: string | null;
        breastPump?: boolean;
    }): Promise<ClientEntity> {
        // Get existing client to check for schedule changes
        const existingClient = await this.findClientByIdUsecase.execute(id);
        if (!existingClient) {
            throw new Error(`Client with id ${id} not found`);
        }

        let primaryScheduleId: number | null | undefined = undefined;
        let secondaryScheduleId: number | null | undefined = undefined;

        const startDate = params.startDate ? new Date(params.startDate) : existingClient.startDate ?? new Date();
        const endDate = params.endDate ? new Date(params.endDate) : existingClient.endDate ?? new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);

        // If primary employee is being changed, create new schedule
        // Only process if primaryEmployeeId is explicitly provided and not null/undefined
        if (params.primaryEmployeeId !== undefined && params.primaryEmployeeId !== null) {
            // Get current employee from existing schedule to check if it actually changed
            let currentPrimaryEmployeeId: number | null = null;
            if (existingClient.primaryScheduleId) {
                const currentSchedule = await this.prismaService.employee_schedule.findUnique({
                    where: { id: existingClient.primaryScheduleId },
                });
                currentPrimaryEmployeeId = currentSchedule?.employee_id ?? null;
            }

            // Only create new schedule if employee actually changed
            if (currentPrimaryEmployeeId !== params.primaryEmployeeId) {
                // Mark old schedule as replaced if exists
                if (existingClient.primaryScheduleId) {
                    await this.prismaService.employee_schedule.update({
                        where: { id: existingClient.primaryScheduleId },
                        data: { replaced: true, end_date: new Date() },
                    });
                }

                // Create new schedule
                const newSchedule = await this.prismaService.employee_schedule.create({
                    data: {
                        employee_id: params.primaryEmployeeId,
                        work_address: params.address ?? existingClient.address ?? "",
                        start_date: startDate,
                        end_date: endDate,
                        replaced: false,
                    },
                });
                primaryScheduleId = newSchedule.id;
            }
            // If employee hasn't changed, keep the existing schedule (primaryScheduleId stays undefined)
        }

        // If secondary employee is being changed
        if (params.secondaryEmployeeId !== undefined) {
            // Get current employee from existing schedule to check if it actually changed
            let currentSecondaryEmployeeId: number | null = null;
            if (existingClient.secondaryScheduleId) {
                const currentSchedule = await this.prismaService.employee_schedule.findUnique({
                    where: { id: existingClient.secondaryScheduleId },
                });
                currentSecondaryEmployeeId = currentSchedule?.employee_id ?? null;
            }

            // Check if employee actually changed
            const employeeChanged = params.secondaryEmployeeId !== currentSecondaryEmployeeId;

            if (employeeChanged) {
                // Mark old schedule as replaced if exists
                if (existingClient.secondaryScheduleId) {
                    await this.prismaService.employee_schedule.update({
                        where: { id: existingClient.secondaryScheduleId },
                        data: { replaced: true, end_date: new Date() },
                    });
                }

                if (params.secondaryEmployeeId !== null) {
                    // Create new schedule
                    const newSchedule = await this.prismaService.employee_schedule.create({
                        data: {
                            employee_id: params.secondaryEmployeeId,
                            work_address: params.address ?? existingClient.address ?? "",
                            start_date: startDate,
                            end_date: endDate,
                            replaced: false,
                        },
                    });
                    secondaryScheduleId = newSchedule.id;
                } else {
                    secondaryScheduleId = null;
                }
            }
            // If employee hasn't changed, keep the existing schedule (secondaryScheduleId stays undefined)
        }

        return this.updateClientUsecase.execute(id, {
            name: params.name,
            primaryScheduleId: primaryScheduleId,
            secondaryScheduleId: secondaryScheduleId,
            address: params.address,
            phone: params.phone,
            type: params.type,
            duration: params.duration,
            fullPrice: params.fullPrice,
            grant: params.grant,
            actualPrice: params.actualPrice,
            startDate: params.startDate === undefined ? undefined : params.startDate ? new Date(params.startDate) : null,
            endDate: params.endDate === undefined ? undefined : params.endDate ? new Date(params.endDate) : null,
            careCenter: params.careCenter,
            voucherClient: params.voucherClient,
            birthday: params.birthday,
            contractStatus: params.contractStatus,
            breastPump: params.breastPump,
        });
    }

    delete(id: number): Promise<void> {
        return this.deleteClientUsecase.execute(id);
    }
}
