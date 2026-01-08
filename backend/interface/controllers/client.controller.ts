import { Body, Controller, Delete, Get, Param, Query, Patch, Post, UseGuards } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { CreateClientDto, UpdateClientDto, TerminateServiceDto, RequestReplacementDto } from "interface/dto/client.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";

@Controller("clients")
@UseGuards(JwtGuard)
export class ClientController {
    constructor(private readonly clientService: ClientService) {}

    @Post()
    create(@Body() dto: CreateClientDto) {
        return this.clientService.create({
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
            serviceStatus: dto.serviceStatus ?? null,
            breastPump: dto.breastPump,
            eDocId: dto.eDocId ?? null,
        });
    }

    @Get()
    findAll(
        @Query("page") page?: string,
        @Query("limit") limit?: string,
        @Query("search") search?: string,
    ) {
        // If pagination params provided, use paginated query
        if (page && limit) {
            return this.clientService.findAllPaginated(
                Number(page),
                Number(limit),
                search,
            );
        }
        // Otherwise return all (for backwards compatibility)
        return this.clientService.findAll();
    }

    @Get(":id")
    findById(@Param("id") id: string) {
        return this.clientService.findById(Number(id));
    }

    @Patch(":id")
    update(@Param("id") id: string, @Body() dto: UpdateClientDto) {
        return this.clientService.update(Number(id), {
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
            serviceStatus: dto.serviceStatus,
            breastPump: dto.breastPump,
            eDocId: dto.eDocId,
        });
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.clientService.delete(Number(id));
    }

    /**
     * Terminate a client's service
     * Sets status to 'terminated' and ends the service immediately
     */
    @Patch(":id/terminate")
    terminate(@Param("id") id: string, @Body() dto: TerminateServiceDto) {
        return this.clientService.terminateService(Number(id), dto.reason);
    }

    /**
     * Request a provider replacement for a client
     * Sets status to 'replacement_requested' and assigns new employees
     */
    @Patch(":id/request-replacement")
    requestReplacement(@Param("id") id: string, @Body() dto: RequestReplacementDto) {
        return this.clientService.requestReplacement(
            Number(id),
            dto.newPrimaryEmployeeId,
            dto.newSecondaryEmployeeId,
        );
    }

    /**
     * Complete a replacement and restore service to normal status
     */
    @Patch(":id/complete-replacement")
    completeReplacement(@Param("id") id: string) {
        return this.clientService.completeReplacement(Number(id));
    }
}
