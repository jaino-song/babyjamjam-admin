import { Inject, Injectable } from "@nestjs/common";
import {
    EFORMSIGN_DOC_REPOSITORY,
    IEformsignDocRepository,
} from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class ListClientNamesByBranchUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(branchid: string): Promise<Array<{ documentId: string; clientName: string }>> {
        return this.eformsignDocRepository.findClientNamesByBranch(branchid);
    }
}
