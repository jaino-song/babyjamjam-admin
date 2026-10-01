import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, MaxLength, registerDecorator } from "class-validator";

/** One `fix` request changes real client records one by one; `keep` is a cheap status write. */
export const RESOLVE_FIX_MAX_ITEMS = 50;
export const RESOLVE_KEEP_MAX_ITEMS = 500;

/** More ids than `fix` allows → validation failure (the global cap is the `keep` one). */
function MaxItemsForFix(max: number): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        registerDecorator({
            name: "maxItemsForFix",
            target: target.constructor,
            propertyName: propertyKey.toString(),
            validator: {
                validate(value: unknown, args): boolean {
                    const action = (args?.object as { action?: unknown } | undefined)?.action;
                    return !Array.isArray(value) || action !== "fix" || value.length <= max;
                },
                defaultMessage(): string {
                    return `fix accepts at most ${max} itemIds`;
                },
            },
        });
    };
}

export class ListHolidayReviewItemsQueryDto {
    @IsOptional()
    @IsIn(["safe", "risk"])
    category?: "safe" | "risk";

    @IsOptional()
    @IsIn(["open", "fixed", "kept", "obsolete"])
    status?: "open" | "fixed" | "kept" | "obsolete";

    /** Client name substring. */
    @IsOptional()
    @IsString()
    @MaxLength(100)
    q?: string;
}

export class ResolveHolidayReviewItemsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(RESOLVE_KEEP_MAX_ITEMS)
    @MaxItemsForFix(RESOLVE_FIX_MAX_ITEMS)
    @ArrayUnique()
    @IsUUID(undefined, { each: true })
    itemIds!: string[];

    @IsIn(["fix", "keep"])
    action!: "fix" | "keep";
}
