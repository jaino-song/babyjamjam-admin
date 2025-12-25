import { Body, Controller, Delete, Get, Param, Query, Patch, Post, UseGuards } from "@nestjs/common";
import { ClientService } from "application/services/client.service";
import { CreateClientDto, UpdateClientDto } from "interface/dto/client.dto";
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
            contractStatus: dto.contractStatus ?? null,
            breastPump: dto.breastPump,
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
            contractStatus: dto.contractStatus,
            breastPump: dto.breastPump,
        });
    }

    @Delete(":id")
    delete(@Param("id") id: string) {
        return this.clientService.delete(Number(id));
    }
}
