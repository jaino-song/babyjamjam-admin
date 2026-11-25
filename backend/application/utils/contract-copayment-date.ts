import { BadRequestException } from "@nestjs/common";

import type { ContractDataDto } from "application/dto/contract.dto";
import { problemBody } from "application/utils/problem-bodies";

/** Convert a request's calendar date to the UTC representation Prisma uses for DATE. */
export function parseContractCopaymentReceivedDate(data: ContractDataDto): Date | undefined {
    const value = data.copaymentReceivedDate;
    if (value === undefined) return undefined;

    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000")) {
        const date = new Date(`${value}T00:00:00.000Z`);
        if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
            && data.paymentYear === value.slice(2, 4)
            && data.paymentMonth === value.slice(5, 7)
            && data.paymentDay === value.slice(8, 10)) {
            return date;
        }
    }

    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
        pointer: "/contractData/copaymentReceivedDate",
        code: "INVALID_VALUE",
        detail: "본인부담금 수령 날짜와 계약서의 결제 연·월·일이 일치해야 해요.",
        location: "body",
    }));
}
