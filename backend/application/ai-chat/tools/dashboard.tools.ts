import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const getDashboardStatsSchema: FunctionDeclaration = {
    name: "getDashboardStats",
    description: `Get dashboard statistics and counts.

USE THIS TOOL when user asks about:
- Client counts: "산모 몇 명", "이용자 수", "고객 수", "엄마 몇 분", "등록된 산모"
- Employee/caregiver counts: "제공인력 몇 명", "관리사 수", "이모님 몇 분", "직원 수", "등록된 직원"
- How many clients/customers are registered in the system
- How many employees/caregivers are registered in the system
- Dashboard overview, summary, or statistics (대시보드, 현황, 통계)
- Clients starting soon (곧 시작, 시작 예정, 입소 예정)
- Clients ending soon (곧 종료, 종료 예정, 퇴소 예정)
- Incomplete contracts (미완료 계약, 계약 미완료)
- Clients without contracts sent (계약서 미발송)

SYNONYMS:
- 산모 = 이용자 = 고객 = 엄마 = client = customer (service recipients)
- 제공인력 = 관리사 = 이모님 = 직원 = employee = caregiver = staff (service providers)

RETURNS:
- totalClients: 전체 등록 산모/이용자 수
- totalEmployees: 전체 등록 제공인력/관리사 수
- startingSoonCount: 곧 서비스 시작하는 산모 수
- endingSoonCount: 곧 서비스 종료되는 산모 수
- incompleteContractsCount: 계약 미완료 산모 수
- noContractCount: 계약서 미발송 산모 수`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const dashboardTools: FunctionDeclaration[] = [
    getDashboardStatsSchema,
];
