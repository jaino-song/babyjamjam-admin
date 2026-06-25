import { Inject, Injectable } from "@nestjs/common";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class ListOtherBranchDocumentIdsUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(branchid: string): Promise<string[]> {
        return this.eformsignDocRepository.findDocumentIdsForOtherBranches(branchid);
    }
}
