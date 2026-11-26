import type { AdminServiceRecordCaseSummary } from "@babyjamjam/shared/types/service-record";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { serviceRecordCaseLabel } from "@/features/service-records/utils/case-selection";

interface ServiceRecordCasePickerProps {
    "data-component": string;
    cases: AdminServiceRecordCaseSummary[];
    selectedCaseId?: string;
    linkFor?: (caseId: string) => string;
    onSelect?: (caseId: string) => void;
}

export function ServiceRecordCasePicker({
    "data-component": base, cases, selectedCaseId, linkFor, onSelect,
}: ServiceRecordCasePickerProps) {
    return (
        <ul data-component={base} data-slot="case-picker" data-source-component="ServiceRecordCasePicker" className="flex flex-wrap gap-2">
            {cases.map((item) => {
                const selected = item.caseId === selectedCaseId;
                const label = serviceRecordCaseLabel(item);
                const names = item.assignees.map(({ name }) => name).join(", ");
                const text = `${label}${names ? ` · ${names}` : ""} · ${item.submittedSessions}/${item.totalSessions}회차${item.retired ? " · 보관" : ""}`;
                const target = { "data-component": `${base}_option_button`, "data-slot": "case-select" };
                return (
                    <li key={item.caseId} data-component={`${base}_option`} data-slot="option">
                        {linkFor ? (
                            <Button asChild variant="outline" {...target}><Link href={linkFor(item.caseId)}>{text}</Link></Button>
                        ) : (
                            <Button type="button" variant={selected ? "positive" : "outline"} {...target}
                                aria-pressed={selected} onClick={() => onSelect?.(item.caseId)}>{text}</Button>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
