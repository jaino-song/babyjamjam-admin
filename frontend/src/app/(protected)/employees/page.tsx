"use client";

import { CalendarDays, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageSection, SectionNav } from "@/components/app/v3";
import { EmployeeDirectoryManager } from "@/components/app/employees/EmployeeDirectoryManager";
import { EmployeeScheduleManager } from "@/components/app/employees/EmployeeScheduleManager";

const EMPLOYEE_SECTIONS = [
    { id: "list", label: "직원 관리", icon: Users },
    { id: "schedule", label: "서비스 일정", icon: CalendarDays },
] as const;

export default function EmployeesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeSection = searchParams.get("section") === "schedule" ? "schedule" : "list";

    const selectSection = (section: string) => {
        router.push(section === "schedule" ? "/employees?section=schedule" : "/employees", { scroll: false });
    };

    return (
        <PageSection name="employees">
            <div data-component="desktop_employees_sections" className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
                <SectionNav
                    data-component="desktop_employees_sections_section-nav"
                    items={EMPLOYEE_SECTIONS}
                    activeId={activeSection}
                    onSelect={selectSection}
                    ariaLabel="직원 페이지 섹션"
                />
                <div data-component="desktop_employees_sections_section-content" className="flex min-h-0 min-w-0 flex-1 flex-col">
                    {activeSection === "list" ? (
                        <section data-component="desktop_employees_sections_section-content_directory" className="flex min-h-0 flex-1 flex-col">
                            <EmployeeDirectoryManager dataComponent="desktop_employees_sections_section-content_directory_manager" />
                        </section>
                    ) : (
                        <section data-component="desktop_employees_sections_section-content_schedule" className="flex min-h-0 flex-1 flex-col">
                            <EmployeeScheduleManager data-component="desktop_employees_sections_section-content_schedule_manager" />
                        </section>
                    )}
                </div>
            </div>
        </PageSection>
    );
}
