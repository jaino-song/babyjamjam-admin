import { Injectable } from "@nestjs/common";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { AlimtalkTriggerDeliveryService } from "./alimtalk-trigger-delivery.service";
import { SmsTriggerDeliveryService } from "./sms-trigger-delivery.service";

@Injectable()
export class MessageTriggerDeliveryService {
    constructor(
        private readonly smsTriggerDeliveryService: SmsTriggerDeliveryService,
        private readonly alimtalkTriggerDeliveryService: AlimtalkTriggerDeliveryService,
    ) {}

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        if (this.smsTriggerDeliveryService.canHandle(job.templateKey)) {
            return this.smsTriggerDeliveryService.sendJob(job);
        }
        return this.alimtalkTriggerDeliveryService.sendJob(job);
    }
}
