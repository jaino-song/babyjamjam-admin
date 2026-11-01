import {
    ArrayNotEmpty,
    ArrayUnique,
    IsArray,
    IsBoolean,
    IsIn,
    IsOptional,
    IsString,
    IsUUID,
    ValidateIf,
} from "class-validator";

export class CreateUserDto {
    @IsString()
    kakaoId!: string;

    @IsString()
    @IsOptional()
    name?: string;

    @IsString()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    profileImage?: string;
}

export class UpdateUserDto {
    @IsString()
    @IsOptional()
    name?: string | null;

    @IsString()
    @IsOptional()
    email?: string | null;

    @IsString()
    @IsOptional()
    profileImage?: string | null;

    @IsIn(["manager", "user"])
    @IsOptional()
    role?: string | null;
}

export class UpdateUserAccountDto {
    @IsIn(["admin", "manager", "user"])
    role!: "admin" | "manager" | "user";

    @IsArray()
    @ArrayNotEmpty()
    @ArrayUnique()
    @IsUUID("4", { each: true })
    branchIds!: string[];

    @IsIn(["admin", "manager", "user"])
    expectedRole!: "admin" | "manager" | "user";

    @IsArray()
    @ArrayUnique()
    @IsUUID("4", { each: true })
    expectedBranchIds!: string[];
}

export class UpdateBranchUserDto {
    @IsIn(["admin", "manager", "user"])
    branchRole!: "admin" | "manager" | "user";
}

export class ApproveUserDto {
    @IsIn(["admin", "manager", "user"])
    role!: "admin" | "manager" | "user";

    @IsUUID("4")
    branchId!: string;

    // A role "admin" approval needs the branch to appoint, named by EITHER adminBranchId or the
    // deprecated ownerBranchId alias. Each field is validated only when it can be the one that
    // supplies the value, so sending just one of them is enough.
    @ValidateIf(
        (dto: ApproveUserDto, value: unknown) =>
            dto.role === "admin" && (value !== undefined || dto.ownerBranchId === undefined),
    )
    @IsUUID("4")
    adminBranchId?: string;

    /** @deprecated use adminBranchId — removed in Release 2 */
    @ValidateIf((dto: ApproveUserDto, value: unknown) => dto.role === "admin" && value !== undefined)
    @IsUUID("4")
    ownerBranchId?: string;

    @ValidateIf((_, value) => value !== undefined)
    @IsBoolean()
    smsAutomationEnabled?: boolean;
}

export class UpdateUserSmsAutomationDto {
    @IsBoolean()
    enabled!: boolean;
}
