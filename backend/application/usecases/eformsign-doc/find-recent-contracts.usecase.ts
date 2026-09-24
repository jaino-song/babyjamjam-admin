import { Inject, Injectable } from "@nestjs/common";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
    RecentEformsignDocRow,
} from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class FindRecentContractsUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(branchid: string, take: number): Promise<RecentEformsignDocRow[]> {
        return this.eformsignDocRepository.findRecentContracts(branchid, take);
    }
}
