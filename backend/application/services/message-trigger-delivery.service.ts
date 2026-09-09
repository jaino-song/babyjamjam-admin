import { Injectable } from "@nestjs/common";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    SmsTriggerDeliveryService,
    SmsTriggerDeliveryPreparation,
} from "./sms-trigger-delivery.service";

@Injectable()
export class MessageTriggerDeliveryService {
    constructor(private readonly smsTriggerDeliveryService: SmsTriggerDeliveryService) {}

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        return this.smsTriggerDeliveryService.sendJob(job);
    }

    async prepareJob(job: MessageTriggerJobEntity): Promise<SmsTriggerDeliveryPreparation | null> {
        return this.smsTriggerDeliveryService.prepareJob(job);
    }

    async sendPreparedJob(
        job: MessageTriggerJobEntity,
        preparation: SmsTriggerDeliveryPreparation,
    ): Promise<boolean> {
        return this.smsTriggerDeliveryService.sendPreparedJob(job, preparation);
    }
}
