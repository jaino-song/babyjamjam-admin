import { Inject, Injectable } from "@nestjs/common";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    IEformsignClientRepository,
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";

/**
 * Fetches all documents from the eformsign external API.
 * Returns raw API response data (not domain entities).
 */
@Injectable()
export class FetchAllEformsignDocsFromApiUsecase {
    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
    ) {}

    execute(accessToken: string): Promise<EformsignApiDocumentResponse[]> {
        return this.eformsignClient.getAllDocuments(accessToken);
    }
}



