export const ALIGO_TEMPLATES = {
    CLIENT_CREATED: {
        code: process.env["ALIGO_TPL_CLIENT_CREATED"] || "TPL_CLIENT_CREATED",
        variables: ["고객명", "등록일", "서비스타입"] as const,
    },
    SERVICE_START_REMINDER: {
        code: process.env["ALIGO_TPL_SERVICE_START_REMINDER"] || "TPL_SERVICE_START_REMINDER",
        variables: ["고객명", "서비스시작일", "발송기준"] as const,
    },
    SERVICE_END_REMINDER: {
        code: process.env["ALIGO_TPL_SERVICE_END_REMINDER"] || "TPL_SERVICE_END_REMINDER",
        variables: ["고객명", "서비스종료일", "발송기준"] as const,
    },
    EMPLOYEE_ASSIGNED: {
        code: process.env["ALIGO_TPL_EMPLOYEE_ASSIGNED"] || "TPL_EMPLOYEE_ASSIGNED",
        variables: ["직원명", "고객명", "서비스시작일"] as const,
    },
    CONTRACT_SIGNED: {
        code: process.env["ALIGO_TPL_CONTRACT_SIGNED"] || "TPL_CONTRACT_SIGNED",
        variables: ["고객명", "계약유형", "계약일", "서비스시작일", "담당자명"] as const,
    },
} as const;

export type AligoTemplateKey = keyof typeof ALIGO_TEMPLATES;
