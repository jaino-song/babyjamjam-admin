import { FunctionDeclaration } from "infrastructure/api/gemini-chat.gateway";

export const listVoucherPricesSchema: FunctionDeclaration = {
    name: "listVoucherPrices",
    description: `List all voucher price information.

USE THIS TOOL when user asks:
- "바우처 가격표", "요금표", "가격 정보", "바우처 요금", "가격 목록"

Returns: List of all voucher prices with type, duration, prices`,
    parameters: {
        type: "object",
        properties: {
            year: {
                type: "number",
                description: "Filter by year (연도, optional)",
            },
        },
        required: [],
    },
};

export const getVoucherPriceByTypeSchema: FunctionDeclaration = {
    name: "getVoucherPriceByType",
    description: `Get voucher prices for a specific type.

USE THIS TOOL when user asks:
- "A형 가격", "통합1형 요금", "바우처 유형별 가격", "A통합1형 얼마야"`,
    parameters: {
        type: "object",
        properties: {
            type: {
                type: "string",
                description: "Voucher type (바우처 유형, e.g., 'A통합1형', 'B통합2형')",
            },
            year: {
                type: "number",
                description: "Filter by year (연도, optional)",
            },
        },
        required: ["type"],
    },
};

export const voucherTools: FunctionDeclaration[] = [
    listVoucherPricesSchema,
    getVoucherPriceByTypeSchema,
];
