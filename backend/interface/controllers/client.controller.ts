import { Body, Controller, Delete, Get, Param, Query, Patch, Post, UseGuards } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { CreateClientDto, UpdateClientDto, TerminateServiceDto, RequestReplacementDto } from "interface/dto/client.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";

@Controller("clients")
@UseGuards(JwtGuard, TenantGuard)
export class ClientController {
    constructor(private readonly clientService: ClientService) {}

    @Post()
    create(@CurrentTenant() tenant: { organizationId?: string }, @Body() dto: CreateClientDto) {
        return this.clientService.create(tenant.organizationId ?? "", {
            name: dto.name,
            primaryEmployeeId: dto.primaryEmployeeId,
            secondaryEmployeeId: dto.secondaryEmployeeId ?? null,
            address: dto.address ?? null,
            phone: dto.phone ?? null,
            type: dto.type ?? null,
            duration: dto.duration ?? null,
            fullPrice: dto.fullPrice ?? null,
            grant: dto.grant ?? null,
            actualPrice: dto.actualPrice ?? null,
            startDate: dto.startDate ?? null,
            endDate: dto.endDate ?? null,
            careCenter: dto.careCenter,
            voucherClient: dto.voucherClient,
            birthday: dto.birthday ?? null,
            dueDate: dto.dueDate ?? null,
            serviceStatus: dto.serviceStatus ?? null,
            breastPump: dto.breastPump,
            eDocId: dto.eDocId ?? null,
        });
    }

    @Get()
    findAll(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("page") page?: string,
        @Query("limit") limit?: string,
        @Query("search") search?: string,
        @Query("filter") filter?: string,
    ) {
        if (filter) {
            return this.clientService.findByFilter(tenant.organizationId ?? "", filter);
        }
        if (page && limit) {
            return this.clientService.findAllPaginated(
                tenant.organizationId ?? "",
                Number(page),
                Number(limit),
                search,
            );
        }
        return this.clientService.findAll(tenant.organizationId ?? "");
    }


    @Get("stats")
    getStats(@CurrentTenant() tenant: { organizationId?: string }) {
        return this.clientService.getStats(tenant.organizationId ?? "");
    }

    @Get("dashboard-overview")
    getDashboardOverview(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("limit") limit?: string,
    ) {
        return this.clientService.getDashboardOverview(
            tenant.organizationId ?? "",
            limit ? Number(limit) : 50,
        );
    }

    @Get("alerts")
    getActionRequiredAlerts(
        @CurrentTenant() tenant: { organizationId?: string },
        @Query("limit") limit?: string,
    ) {
        return this.clientService.getActionRequiredAlerts(
            tenant.organizationId ?? "",
            limit ? Number(limit) : 3,
        );
    }

    @Get(":id")
    findById(@CurrentTenant() tenant: { organizationId?: string }, @Param("id") id: string) {
        return this.clientService.findById(tenant.organizationId ?? "", Number(id));
    }

    @Patch(":id")
    update(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
        @Body() dto: UpdateClientDto
    ) {
        return this.clientService.update(tenant.organizationId ?? "", Number(id), {
            name: dto.name,
            primaryEmployeeId: dto.primaryEmployeeId,
            secondaryEmployeeId: dto.secondaryEmployeeId,
            address: dto.address,
            phone: dto.phone,
            type: dto.type,
            duration: dto.duration,
            fullPrice: dto.fullPrice,
            grant: dto.grant,
            actualPrice: dto.actualPrice,
            startDate: dto.startDate,
            endDate: dto.endDate,
            careCenter: dto.careCenter,
            voucherClient: dto.voucherClient,
            birthday: dto.birthday,
            dueDate: dto.dueDate,
            serviceStatus: dto.serviceStatus,
            breastPump: dto.breastPump,
            eDocId: dto.eDocId,
        });
    }

    @Delete(":id")
    delete(@CurrentTenant() tenant: { organizationId?: string }, @Param("id") id: string) {
        return this.clientService.delete(tenant.organizationId ?? "", Number(id));
    }

    /**
     * Terminate a client's service
     * Sets status to 'terminated' and ends the service immediately
     */
    @Patch(":id/terminate")
    terminate(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
        @Body() dto: TerminateServiceDto
    ) {
        return this.clientService.terminateService(tenant.organizationId ?? "", Number(id), dto.reason);
    }

    /**
     * Request a provider replacement for a client
     * Sets status to 'replacement_requested' and assigns new employees
     */
    @Patch(":id/request-replacement")
    requestReplacement(
        @CurrentTenant() tenant: { organizationId?: string },
        @Param("id") id: string,
        @Body() dto: RequestReplacementDto
    ) {
        return this.clientService.requestReplacement(
            tenant.organizationId ?? "",
            Number(id),
            dto.newPrimaryEmployeeId,
            dto.newSecondaryEmployeeId,
        );
    }

    /**
     * Complete a replacement and restore service to normal status
     */
    @Patch(":id/complete-replacement")
    completeReplacement(@CurrentTenant() tenant: { organizationId?: string }, @Param("id") id: string) {
        return this.clientService.completeReplacement(tenant.organizationId ?? "", Number(id));
    }
}
