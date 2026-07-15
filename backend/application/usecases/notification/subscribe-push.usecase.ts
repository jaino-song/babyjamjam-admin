import { Injectable, Inject } from "@nestjs/common";
import {
    IPushSubscriptionRepository,
    PUSH_SUBSCRIPTION_REPOSITORY,
} from "domain/repositories/push-subscription.repository.interface";
import { PushSubscriptionEntity } from "domain/entities/push-subscription.entity";

/**
 * Subscribe Push Use Case
 *
 * 브라우저에서 받은 PushSubscription 정보를 저장.
 * 이미 동일한 endpoint가 있으면 업데이트하지 않음 (중복 방지).
 */
@Injectable()
export class SubscribePushUsecase {
    constructor(
        @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
        private pushSubscriptionRepository: IPushSubscriptionRepository,
    ) {}

    async execute(
        userId: string,
        endpoint: string,
        p256dhKey: string,
        authKey: string,
        userAgent?: string,
    ): Promise<PushSubscriptionEntity> {
        // 이미 존재하는 구독인지 확인
        const existing = await this.pushSubscriptionRepository.findByEndpoint(endpoint);
        if (existing) {
            // 이미 존재하면 기존 것 반환 (다른 사용자의 것이라면 덮어쓰기 가능하지만, 보안상 기존 것 유지)
            return existing;
        }

        const subscription = PushSubscriptionEntity.create(
            userId,
            endpoint,
            p256dhKey,
            authKey,
            userAgent,
        );

        return this.pushSubscriptionRepository.create(subscription);
    }
}
