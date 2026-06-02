import { Body, Controller, Delete, Get, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CreateBankAccountInfoDto, UpdateBankAccountInfoDto } from "../dto/bank-account-info.dto";

@Controller("bank-account-infos")
export class BankAccountInfoController {
    constructor(private readonly bankAccountInfoService: BankAccountInfoService) {}

    @Post()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    create(@Body() createBankAccountInfoDto: CreateBankAccountInfoDto) {
        return this.bankAccountInfoService.create(createBankAccountInfoDto);
    }

    @Get()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    findAll() {
        return this.bankAccountInfoService.findAll();
    }

    @Get("area")
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    async findByArea(@Query("area") area: string) {
        const result = await this.bankAccountInfoService.findByArea(area);
        return result;
    }

    @Patch()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    update(@Query("area") area: string, @Body() updateBankAccountInfoDto: UpdateBankAccountInfoDto) {
        return this.bankAccountInfoService.update(area, updateBankAccountInfoDto);
    }

    @Delete()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    delete(@Query("area") area: string) {
        return this.bankAccountInfoService.delete(area);
    }
}
