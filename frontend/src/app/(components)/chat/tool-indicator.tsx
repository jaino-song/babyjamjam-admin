"use client";

import { Box, Typography } from "@mui/material";

interface ToolIndicatorProps {
    toolName: string | null;
    isExecuting: boolean;
}

// Map tool names to friendly Korean labels
const TOOL_LABELS: Record<string, string> = {
    searchClients: "산모 검색 중",
    getClient: "산모 정보 조회 중",
    getClientsByFilter: "산모 필터 조회 중",
    createClient: "산모 등록 중",
    updateClient: "산모 정보 수정 중",
    deleteClient: "산모 삭제 중",
    terminateClientService: "서비스 종료 처리 중",
    requestEmployeeReplacement: "관리사 교체 요청 중",
    searchEmployees: "관리사 검색 중",
    getEmployee: "관리사 정보 조회 중",
    getAvailableEmployees: "가용 관리사 조회 중",
    getEmployeesByWorkArea: "지역별 관리사 조회 중",
    getEmployeesByGrade: "등급별 관리사 조회 중",
    createEmployee: "관리사 등록 중",
    updateEmployee: "관리사 정보 수정 중",
    deleteEmployee: "관리사 삭제 중",
    changeEmployeeAvailability: "관리사 상태 변경 중",
    listSchedules: "스케줄 조회 중",
    getSchedulesByEmployee: "관리사 스케줄 조회 중",
    listAvailableTemplates: "계약서 템플릿 조회 중",
    createAndSendContract: "계약서 발송 중",
    getContractStatus: "계약서 상태 확인 중",
    listAllContracts: "계약서 목록 조회 중",
    listVoucherPrices: "바우처 가격 조회 중",
    getVoucherPriceByType: "바우처 유형별 가격 조회 중",
    listBankAccounts: "계좌 정보 조회 중",
    getBankAccountByArea: "지역별 계좌 조회 중",
    getMessages: "메시지 조회 중",
    createMessage: "메시지 생성 중",
    updateMessage: "메시지 수정 중",
    deleteMessage: "메시지 삭제 중",
    getDashboardStats: "대시보드 통계 조회 중",
};

function getToolLabel(toolName: string | null): string {
    if (!toolName) return "처리 중";
    return TOOL_LABELS[toolName] || `${toolName} 실행 중`;
}

export function ToolIndicator({ toolName, isExecuting }: ToolIndicatorProps) {
    if (!isExecuting) return null;

    return (
        <Box
            data-testid="tool-indicator"
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                py: 1,
                px: 2,
                bgcolor: "action.hover",
                borderRadius: 1,
                mb: 1,
            }}
        >
            {/* Animated dots */}
            <Box sx={{ display: "flex", gap: 0.5 }}>
                {[0, 1, 2].map((i) => (
                    <Box
                        key={i}
                        sx={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            bgcolor: "primary.main",
                            animation: "pulse 1.4s ease-in-out infinite",
                            animationDelay: `${i * 0.2}s`,
                            "@keyframes pulse": {
                                "0%, 80%, 100%": { opacity: 0.3, transform: "scale(0.8)" },
                                "40%": { opacity: 1, transform: "scale(1)" },
                            },
                        }}
                    />
                ))}
            </Box>
            <Typography variant="body2" color="text.secondary">
                {getToolLabel(toolName)}...
            </Typography>
        </Box>
    );
}
