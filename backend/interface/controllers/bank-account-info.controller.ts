import { Controller, Post, Body, Get, Query, Patch, Delete, NotFoundException } from "@nestjs/common";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { CreateBankAccountInfoDto, UpdateBankAccountInfoDto } from "../dto/bank-account-info.dto";

@Controller("bank-account-infos")
export class BankAccountInfoController {
    constructor(private readonly bankAccountInfoService: BankAccountInfoService) {}

    @Post()
    create(@Body() createBankAccountInfoDto: CreateBankAccountInfoDto) {
        return this.bankAccountInfoService.create(createBankAccountInfoDto);
    }

    @Get()
    findAll() {
        return this.bankAccountInfoService.findAll();
    }

    @Get("area")
    async findByArea(@Query("area") area: string) {
        const result = await this.bankAccountInfoService.findByArea(area);
        return result;
    }

    @Patch()
    update(@Query("area") area: string, @Body() updateBankAccountInfoDto: UpdateBankAccountInfoDto) {
        return this.bankAccountInfoService.update(area, updateBankAccountInfoDto);
    }

    @Delete()
    delete(@Query("area") area: string) {
        return this.bankAccountInfoService.delete(area);
    }
}