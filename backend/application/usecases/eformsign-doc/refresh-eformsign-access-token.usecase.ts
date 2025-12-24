import { Inject, Injectable } from "@nestjs/common";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    IEformsignClientRepository,
    EformsignTokenResponse,
} from "domain/repositories/eformsign.client.interface";

@Injectable()
export class RefreshEformsignAccessTokenUsecase {
    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
    ) {}

    execute(executionTime: number, refreshToken: string): Promise<EformsignTokenResponse> {
        return this.eformsignClient.refreshAccessToken(executionTime, refreshToken);
    }
}



