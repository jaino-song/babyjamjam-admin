import { Inject, Injectable } from "@nestjs/common";
import {
    EformsignDocClientSummary,
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class ListClientNamesByBranchUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(branchid: string): Promise<EformsignDocClientSummary[]> {
        return this.eformsignDocRepository.findClientNamesByBranch(branchid);
    }
}
