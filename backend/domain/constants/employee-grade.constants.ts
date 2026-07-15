export const EMPLOYEE_GRADES = ["프리미엄", "베스트", "스탠다드"] as const;

export const DEFAULT_EMPLOYEE_GRADE = EMPLOYEE_GRADES[2];

type EmployeeGrade = (typeof EMPLOYEE_GRADES)[number];

function normalizeGradeKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, "");
}

export function normalizeEmployeeGrade(grade: string | null | undefined): EmployeeGrade | "" {
    if (typeof grade !== "string") {
        return "";
    }

    const normalizedKey = normalizeGradeKey(grade);
    if (!normalizedKey) {
        return "";
    }

    if (normalizedKey === "스텐다드") {
        return "스탠다드";
    }

    return EMPLOYEE_GRADES.find((candidate) => normalizeGradeKey(candidate) === normalizedKey) ?? "";
}

export function isEmployeeGrade(grade: string | null | undefined): grade is EmployeeGrade {
    return EMPLOYEE_GRADES.includes(grade as EmployeeGrade);
}
