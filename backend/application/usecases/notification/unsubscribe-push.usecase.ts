import { Injectable, Inject } from "@nestjs/common";
import {
    IPushSubscriptionRepository,
    PUSH_SUBSCRIPTION_REPOSITORY,
} from "domain/repositories/push-subscription.repository.interface";

/**
 * Unsubscribe Push Use Case
 *
 * 브라우저에서 구독 해제 시 호출.
 * endpoint로 구독 정보 삭제.
 */
@Injectable()
export class UnsubscribePushUsecase {
    constructor(
        @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
        private pushSubscriptionRepository: IPushSubscriptionRepository,
    ) {}

    async execute(endpoint: string): Promise<void> {
        await this.pushSubscriptionRepository.deleteByEndpoint(endpoint);
    }
}
