import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    ForbiddenException,
    Get,
    Patch,
    Post,
    Query,
    Request,
    UseGuards,
} from "@nestjs/common";
import { BankAccountInfoService } from "application/services/bank-account-info.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { CreateBankAccountInfoDto, UpdateBankAccountInfoDto } from "../dto/bank-account-info.dto";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";

@Controller("bank-account-infos")
export class BankAccountInfoController {
    constructor(private readonly bankAccountInfoService: BankAccountInfoService) {}

    @Post()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    create(@Body() createBankAccountInfoDto: CreateBankAccountInfoDto, @Request() req: any) {
        const branchId = this.requireBranchId(req);
        return this.bankAccountInfoService.create(createBankAccountInfoDto, branchId);
    }

    @Get()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    findAll(@Request() req: any) {
        const branchId = this.requireBranchId(req);
        return this.bankAccountInfoService.findAll(branchId);
    }

    @Get("area")
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    async findByArea(@Query("area") area: string, @Request() req: any) {
        const branchId = this.requireBranchId(req);
        const result = await this.bankAccountInfoService.findByArea(this.requireArea(area), branchId);
        return result;
    }

    @Patch()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    update(@Query("area") area: string, @Body() updateBankAccountInfoDto: UpdateBankAccountInfoDto, @Request() req: any) {
        const branchId = this.requireBranchId(req);
        return this.bankAccountInfoService.update(this.requireArea(area), updateBankAccountInfoDto, branchId);
    }

    @Delete()
    @UseGuards(JwtGuard, OwnerOrAdminGuard)
    delete(@Query("area") area: string, @Request() req: any) {
        const branchId = this.requireBranchId(req);
        return this.bankAccountInfoService.delete(this.requireArea(area), branchId);
    }

    // The caller's branch comes only from the JWT-derived session (request.user.branchId,
    // populated by JwtStrategy once POST /auth/select-branch has run) — never from a
    // client-supplied value. Fail closed rather than let an unresolved branch reach a Prisma
    // query, where an `undefined` filter key would silently be dropped and become "no filter".
    private requireBranchId(req: any): string {
        const branchId = req.user?.branchId;
        if (!branchId) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }
        return branchId;
    }

    // Same hazard as requireBranchId, on the other filter key: `@Query("area")` is
    // `undefined` when the parameter is absent, and Prisma drops `undefined` where-keys.
    // Unguarded, `DELETE /bank-account-infos` (no ?area=) becomes "delete every row in
    // this branch" and `PATCH` becomes "rewrite an arbitrary row in this branch".
    private requireArea(area: unknown): string {
        if (typeof area !== "string" || area.length === 0) {
            throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                pointer: "/area",
                code: "REQUIRED",
                detail: "area를 입력해 주세요.",
                location: "query",
            }));
        }
        return area;
    }
}
