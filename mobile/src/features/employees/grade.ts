export const EMPLOYEE_GRADES = ["프리미엄", "베스트", "스탠다드"] as const;

export const DEFAULT_EMPLOYEE_GRADE = EMPLOYEE_GRADES[2];

const LEGACY_GRADE_MAP: Record<string, string> = {
    "1급": "프리미엄",
    "2급": "베스트",
    "3급": "스탠다드",
    스텐다드: "스탠다드",
};

export function normalizeEmployeeGrade(grade: string | null | undefined): string {
    if (typeof grade !== "string") {
        return DEFAULT_EMPLOYEE_GRADE;
    }

    const trimmedGrade = grade.trim();
    if (!trimmedGrade) {
        return DEFAULT_EMPLOYEE_GRADE;
    }

    return LEGACY_GRADE_MAP[trimmedGrade] ?? trimmedGrade;
}

export function getEmployeeGradeBadgeStyle(
    grade: string
): { label: string; variant: "amber" | "success" | "primary" } {
    const normalizedGrade = normalizeEmployeeGrade(grade);

    switch (normalizedGrade) {
        case "프리미엄":
            return {
                label: normalizedGrade,
                variant: "amber",
            };
        case "베스트":
            return {
                label: normalizedGrade,
                variant: "success",
            };
        case "스탠다드":
        default:
            return {
                label: normalizedGrade,
                variant: "primary",
            };
    }
}
