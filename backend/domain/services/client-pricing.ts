interface ClientPricingInput {
    voucherClient: boolean;
    type: string | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
}

interface ClientPricingFields {
    type: string | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
}

export function normalizeClientPricing(input: ClientPricingInput): ClientPricingFields {
    if (input.voucherClient) {
        return {
            type: input.type,
            fullPrice: input.fullPrice,
            grant: input.grant,
            actualPrice: input.actualPrice,
        };
    }

    return {
        type: null,
        fullPrice: input.fullPrice,
        grant: "0",
        actualPrice: input.fullPrice,
    };
}
