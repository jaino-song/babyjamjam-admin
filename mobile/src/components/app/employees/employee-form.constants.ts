export const WORK_AREAS = [
  "인천 연수구",
  "인천 남동구",
  "인천 부평구",
  "인천 계양구",
  "인천 미추홀구",
  "인천 서구",
  "인천 중구",
  "인천 동구",
] as const;

export function formatWorkAreaLabel(area: string): string {
  return area.replace(/^인천(?:광역시)?\s+/, "");
}

export { DEFAULT_EMPLOYEE_GRADE, EMPLOYEE_GRADES as GRADES, normalizeEmployeeGrade } from "@/features/employees/grade";
