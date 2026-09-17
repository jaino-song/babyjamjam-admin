import { registerDecorator, ValidationOptions } from "class-validator";
import { isValidBirthdayIsoDate, normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";

/** New forms send ISO dates; retain six-digit writes during the client rollout. */
export function IsBirthdayDate(validationOptions?: ValidationOptions): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        registerDecorator({
            name: "isBirthdayDate",
            target: target.constructor,
            propertyName: propertyKey.toString(),
            options: validationOptions,
            validator: {
                validate(value: unknown): boolean {
                    return typeof value === "string" && (
                        isValidBirthdayIsoDate(value)
                        || (/^\d{6}$/.test(value) && normalizeBirthdayIsoDate(value) !== null)
                    );
                },
                defaultMessage(): string {
                    return "생년월일은 YYYY-MM-DD 형식의 유효한 날짜여야 합니다.";
                },
            },
        });
    };
}
