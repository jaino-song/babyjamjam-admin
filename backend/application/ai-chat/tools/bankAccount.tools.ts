import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listBankAccountsSchema: FunctionDeclaration = {
    name: "listBankAccounts",
    description: `List all bank account information by area.

USE THIS TOOL when user asks:
- "계좌 정보", "입금 계좌", "은행 계좌 목록", "계좌번호"

Returns: List of all bank accounts with area, bank name, account number`,
    parameters: {
        type: "object",
        properties: {},
        required: [],
    },
};

export const getBankAccountByAreaSchema: FunctionDeclaration = {
    name: "getBankAccountByArea",
    description: `Get bank account information for a specific area.

USE THIS TOOL when user asks:
- "인천 계좌", "강남구 입금 계좌", "지역별 계좌", "인천 계좌번호"`,
    parameters: {
        type: "object",
        properties: {
            area: {
                type: "string",
                description: "Area name (지역명, e.g., '인천', '강남구')",
            },
        },
        required: ["area"],
    },
};

export const bankAccountTools: FunctionDeclaration[] = [
    listBankAccountsSchema,
    getBankAccountByAreaSchema,
];
