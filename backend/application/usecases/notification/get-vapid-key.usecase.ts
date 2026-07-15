import { Injectable, Inject } from "@nestjs/common";
import { IWebPushPort, WEB_PUSH_PORT } from "domain/ports/web-push.port";

/**
 * Get VAPID Key Use Case
 *
 * 프론트엔드에서 push 구독 시 필요한 VAPID public key 반환.
 */
@Injectable()
export class GetVapidKeyUsecase {
    constructor(
        @Inject(WEB_PUSH_PORT)
        private webPushPort: IWebPushPort,
    ) {}

    execute(): string {
        return this.webPushPort.getVapidPublicKey();
    }
}
