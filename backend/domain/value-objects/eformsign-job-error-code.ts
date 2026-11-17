const JOB_ERROR_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_:-]{0,79}$/;

export function toJobErrorCode(code: string): string {
    if (JOB_ERROR_CODE_PATTERN.test(code)) return code;

    const normalized = code.toUpperCase()
        .replace(/[^A-Z0-9_:-]/g, "_")
        .replace(/^[^A-Z0-9]+/, "")
        .slice(0, 80);
    return JOB_ERROR_CODE_PATTERN.test(normalized) ? normalized : "JOB_ERROR_CODE_INVALID";
}
