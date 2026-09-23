import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { AgentCapabilityProvider } from "application/agent/capability.decorator";
import type { AgentCapabilityProviderContract, CapabilityDefinition } from "application/agent/capability.types";
import { ListVoucherPriceInfoUsecase } from "./list-voucher-price-info.usecase";

const ItemSchema = z.object({ id: z.number().int().positive(), type: z.string().nullable(), duration: z.string().nullable(), fullPrice: z.string().nullable(), grant: z.string().nullable(), actualPrice: z.string().nullable(), year: z.number().int() });
const InputSchema = z.object({
    year: z.number().int().min(2000).max(2100).optional().describe("Optional 4-digit year to filter voucher prices."),
    type: z.string().trim().max(80).optional().describe("Optional partial, case-insensitive match against the voucher type/duration label."),
});
const OutputSchema = z.object({ items: z.array(ItemSchema) });

@Injectable()
@AgentCapabilityProvider()
export class VoucherAgentCapabilitiesProvider implements AgentCapabilityProviderContract {
    constructor(private readonly listVoucherPrices: ListVoucherPriceInfoUsecase) {}

    getCapabilities(): CapabilityDefinition[] {
        return [{
            meta: { name: "vouchers.prices", domain: "vouchers", version: "1.0.0", description: "Read the branch's voucher price list (government voucher service pricing by type, duration and year) — not an individual client's voucher balance or usage. Use for: 바우처 단가, 정부지원 가격표, 서비스 요금 확인. Input: optional year (2000-2100) and optional type keyword, matched partially. Returns, up to 100 rows: id, type, duration, fullPrice, grant, actualPrice, year.", risk: "read", requiredRoles: ["owner", "admin", "manager"], renderer: "text", flagKey: "agent.capability.vouchers.prices", sideEffect: false },
            inputSchema: InputSchema, outputSchema: OutputSchema,
            execute: async (_context, rawInput) => {
                const input = InputSchema.parse(rawInput);
                const items = await this.listVoucherPrices.execute();
                return { items: items.filter((item) => (input.year === undefined || item.year === input.year) && (!input.type || item.type?.toLocaleLowerCase().includes(input.type.toLocaleLowerCase()))).slice(0, 100).map((item) => ({ id: item.id, type: item.type, duration: item.duration?.toString() ?? null, fullPrice: item.fullPrice, grant: item.grant, actualPrice: item.actualPrice, year: item.year })) };
            },
        }];
    }
}
