import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { BankAccountInfoEntity } from "domain/entities/bank-account-info.entity";
import { BANK_ACCOUNT_INFO_REPOSITORY, IBankAccountInfoRepository } from "domain/repositories/bank-account-info.repository.interface";

@Injectable()
export class CreateBankAccountInfoUsecase {
    constructor(
        @Inject(BANK_ACCOUNT_INFO_REPOSITORY)
        private readonly bankAccountInfoRepository: IBankAccountInfoRepository,
    ) {}

    async execute(area: string, bankName: string, accNum: string, branchId: string): Promise<BankAccountInfoEntity> {
        // The target area id is client-supplied: verify it belongs to the
        // caller's branch before writing, or a branch-A admin could plant a
        // payment-routing row on a branch-B area. 404 (not 403) so the
        // response does not confirm another branch's area id exists.
        const owned = await this.bankAccountInfoRepository.areaBelongsToBranch(area, branchId);
        if (!owned) {
            // The area id is caller-supplied: the registered code carries the
            // 404 without confirming whether another branch owns the area.
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }
        const bankAccountInfo = BankAccountInfoEntity.create(area, bankName, accNum);
        return this.bankAccountInfoRepository.create(bankAccountInfo);
    }
}
