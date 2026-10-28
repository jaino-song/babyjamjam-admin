import { validationProblemResponse } from "@/lib/api/problem-responses";

export function isPositiveIntegerString(value: string): boolean {
    return /^[1-9]\d*$/.test(value);
}

export function invalidClientIdResponse() {
    return validationProblemResponse("Invalid client id", [
        { pointer: "/clientId", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" },
    ]);
}
