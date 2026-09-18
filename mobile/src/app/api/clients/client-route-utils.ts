import { validationProblemResponse } from "@/lib/api/problem-responses";

export function isValidClientId(id: string): boolean {
    return /^[1-9]\d*$/.test(id);
}

export function invalidClientIdResponse() {
    return validationProblemResponse("Invalid client id", [
        { pointer: "/id", code: "INVALID_FORMAT", detail: "입력 형식이 올바르지 않아요.", location: "path" },
    ]);
}
