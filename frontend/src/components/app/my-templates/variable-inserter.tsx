"use client";

import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface VariableInserterProps {
    onInsert: (key: string) => void;
    /** Candidate variables supplied by the owning editor. */
    variables?: readonly VariableInserterVariable[];
    /** System templates expose registry variables only; custom definition UI stays off. */
    allowCustom?: boolean;
    /** Full data-component path supplied by the owning organism. */
    dataComponent?: string;
    disabled?: boolean;
}

export interface VariableInserterVariable {
    key: string;
    label: string;
}

export const PRESET_VARIABLES = [
    { key: "name", label: "이름" },
    { key: "phone", label: "연락처" },
    { key: "address", label: "주소" },
    { key: "startDate", label: "시작일" },
    { key: "endDate", label: "종료일" },
    { key: "area", label: "지역" },
    { key: "voucherType", label: "바우처유형" },
    { key: "fullPrice", label: "총금액" },
    { key: "actualPrice", label: "본인부담금" },
    { key: "employeeName", label: "직원명" },
];

export const VariableInserter = ({
    onInsert,
    variables = PRESET_VARIABLES,
    allowCustom = true,
    dataComponent = "desktop_my-templates_variable-inserter",
    disabled = false,
}: VariableInserterProps) => {
    const handleAddCustom = () => {
        if (disabled) return;
        const key = prompt("변수 키를 입력하세요 (영문 권장):");
        if (key) {
            onInsert(key.trim());
        }
    };

    return (
        <div data-component={dataComponent} className="flex flex-row flex-wrap gap-2">
            {variables.map((v) => (
                <Badge
                    key={v.key}
                    asChild
                    variant="outline"
                    className="cursor-pointer enabled:hover:bg-primary enabled:hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                    <button type="button" disabled={disabled} onClick={() => onInsert(v.key)} data-component={`${dataComponent}_variable-button`}>
                        {v.label}
                    </button>
                </Badge>
            ))}
            {allowCustom ? (
                <Badge
                    asChild
                    variant="outline"
                    className="cursor-pointer enabled:hover:bg-secondary enabled:hover:text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
                >
                    <button type="button" disabled={disabled} onClick={handleAddCustom} data-component={`${dataComponent}_custom-button`}>
                        <Plus className="h-3 w-3 mr-1" />
                        커스텀 변수
                    </button>
                </Badge>
            ) : null}
        </div>
    );
};
