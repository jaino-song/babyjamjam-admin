import { Inject, Injectable } from "@nestjs/common";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    IEformsignClientRepository,
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";

/**
 * Fetches a single document from the eformsign external API by document ID.
 * Returns raw API response data (not domain entity).
 */
@Injectable()
export class FetchEformsignDocFromApiUsecase {
    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
    ) {}

    execute(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse> {
        return this.eformsignClient.getDocument(accessToken, documentId);
    }
}



