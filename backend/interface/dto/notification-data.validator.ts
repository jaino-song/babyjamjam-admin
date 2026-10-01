import { registerDecorator, ValidationOptions } from "class-validator";

/** Serialized `data` payload above this size is rejected outright. */
const MAX_DATA_BYTES = 2048;

/** `url` values above this length are rejected outright. */
const MAX_URL_LENGTH = 500;

/**
 * A relative, same-origin path: starts with a single `/`, never `//` or
 * `/\` (both of which browsers/service workers can resolve as
 * protocol-relative or backslash-as-slash external URLs).
 */
function isSafeRelativeUrl(value: string): boolean {
    if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
    if (!value.startsWith("/")) return false;
    if (value.startsWith("//")) return false;
    if (value.startsWith("/\\")) return false;
    return true;
}

/**
 * Manual notification `data` is attacker-controlled (a branch manager can
 * send it) and its `url` field is opened by the client/service worker with
 * no origin check. Restrict `data.url` to a same-origin relative path and
 * cap the serialized payload size so it can only carry small, safe, in-app
 * navigation hints.
 */
export function IsSafeNotificationData(validationOptions?: ValidationOptions): PropertyDecorator {
    return (target: object, propertyKey: string | symbol) => {
        registerDecorator({
            name: "isSafeNotificationData",
            target: target.constructor,
            propertyName: propertyKey.toString(),
            options: validationOptions,
            validator: {
                validate(value: unknown): boolean {
                    if (value === null || value === undefined) return true;
                    if (typeof value !== "object" || Array.isArray(value)) return false;

                    let serialized: string;
                    try {
                        serialized = JSON.stringify(value);
                    } catch {
                        return false;
                    }
                    if (Buffer.byteLength(serialized, "utf8") > MAX_DATA_BYTES) return false;

                    const url = (value as Record<string, unknown>)["url"];
                    if (url === undefined) return true;
                    return typeof url === "string" && isSafeRelativeUrl(url);
                },
                defaultMessage(): string {
                    return "data.url은 \"/\"로 시작하는 내부 상대 경로여야 하며, data는 2048바이트를 초과할 수 없습니다.";
                },
            },
        });
    };
}
