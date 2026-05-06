import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";

@Injectable()
export class ApproveStaffDocumentUsecase {
    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
    ) {}

    async execute(branchId: string, documentId: string): Promise<void> {
        if (!branchId) {
            throw new BadRequestException("branchId is required");
        }

        if (!documentId) {
            throw new BadRequestException("documentId is required");
        }

        const tokenResponse = await this.eformsignClient.getAccessToken(Date.now());
        const accessToken = tokenResponse.oauth_token?.access_token;

        if (!accessToken) {
            throw new BadRequestException("Failed to acquire eformsign access token");
        }

        await this.eformsignClient.approveDocument(accessToken, documentId);
    }
}
