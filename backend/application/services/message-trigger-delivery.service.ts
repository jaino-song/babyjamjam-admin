import { Injectable } from "@nestjs/common";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { SmsTriggerDeliveryService } from "./sms-trigger-delivery.service";

@Injectable()
export class MessageTriggerDeliveryService {
    constructor(private readonly smsTriggerDeliveryService: SmsTriggerDeliveryService) {}

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        return this.smsTriggerDeliveryService.sendJob(job);
    }
}
