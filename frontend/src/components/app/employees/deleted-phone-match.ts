export interface DeletedPhoneMatch {
    name?: string;
    detail: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

/** Read the whitelisted extension from the HTTP body, not the normalized catalog problem. */
export function getDeletedPhoneMatch(error: unknown): DeletedPhoneMatch | null {
    if (!isRecord(error) || !isRecord(error.response)) return null;
    const { status, data } = error.response;
    if (status !== 409 || !isRecord(data) || data.code !== "EMPLOYEE_PHONE_HELD_BY_DELETED") return null;
    const deleted = data.deletedEmployee;
    const name = isRecord(deleted)
        && Number.isInteger(deleted.id) && Number(deleted.id) > 0
        && typeof deleted.name === "string" && deleted.name.length <= 100
        ? deleted.name : undefined;
    return {
        name,
        detail: typeof data.detail === "string" ? data.detail : "이전에 삭제된 제공인력이 이 전화번호를 사용했어요. 복원하거나 새 관리사로 등록할 수 있어요.",
    };
}
