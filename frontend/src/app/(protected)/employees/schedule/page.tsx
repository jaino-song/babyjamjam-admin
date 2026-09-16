import { EmployeeScheduleManager } from "@/components/app/employees/EmployeeScheduleManager";

export default function EmployeeSchedulePage() {
    return (
        <section
            data-component="desktop_employees-schedule_page"
            className="flex h-full min-h-0 flex-col"
        >
            <EmployeeScheduleManager data-component="desktop_employees-schedule_page_manager" />
        </section>
    );
}
