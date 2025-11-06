import { Controller, Post, Body, Get, Query, Patch, Delete } from "@nestjs/common";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { CreateBankAccountInfoDto, UpdateBankAccountInfoDto } from "../dto/bank-account-info.dto";

@Controller("bank-account-infos")
export class BankAccountInfoController {
    constructor(private readonly bankAccountInfoService: BankAccountInfoService) {}

    @Post()
    create(@Body() createBankAccountInfoDto: CreateBankAccountInfoDto) {
        return this.bankAccountInfoService.create(createBankAccountInfoDto);
    }

    @Get("area")
    findByArea(@Query("area") area: string) {
        return this.bankAccountInfoService.findByArea(area);
    }

    @Get()
    findAll() {
        return this.bankAccountInfoService.findAll();
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