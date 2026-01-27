"use client";

import { Stack, Chip, Button, Box, Typography } from "@mui/material";
import { Add as AddIcon } from "@mui/icons-material";
import { useState } from "react";

interface VariableInserterProps {
    onInsert: (key: string) => void;
}

const PRESET_VARIABLES = [
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

export const VariableInserter = ({ onInsert }: VariableInserterProps) => {
    const [customKey, setCustomKey] = useState("");

    const handleAddCustom = () => {
        const key = prompt("변수 키를 입력하세요 (영문 권장):");
        if (key) {
            onInsert(key.trim());
        }
    };

    return (
        <Box>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {PRESET_VARIABLES.map((v) => (
                    <Chip 
                        key={v.key} 
                        label={v.label} 
                        onClick={() => onInsert(v.key)}
                        color="primary"
                        variant="outlined"
                        size="small"
                    />
                ))}
                <Chip 
                    label="커스텀 변수" 
                    onClick={handleAddCustom}
                    icon={<AddIcon />}
                    color="secondary"
                    variant="outlined"
                    size="small"
                />
            </Stack>
        </Box>
    );
};
