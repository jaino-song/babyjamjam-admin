import { Inject, Injectable } from "@nestjs/common";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";

@Injectable()
export class FindEformsignDocByIdUsecase {
    constructor(
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
    ) {}

    execute(organizationid: string, id: number): Promise<EformsignDocEntity | null> {
        return this.eformsignDocRepository.findById(organizationid, id);
    }
}
