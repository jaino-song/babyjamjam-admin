import { Injectable } from "@nestjs/common";
import { isRetiredFixedEventTemplate } from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import {
    SmsTriggerDeliveryService,
    SmsTriggerDeliveryPreparation,
} from "./sms-trigger-delivery.service";

@Injectable()
export class MessageTriggerDeliveryService {
    constructor(private readonly smsTriggerDeliveryService: SmsTriggerDeliveryService) {}

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        if (this.cancelRetiredTemplate(job)) return false;
        return this.smsTriggerDeliveryService.sendJob(job);
    }

    async prepareJob(job: MessageTriggerJobEntity): Promise<SmsTriggerDeliveryPreparation | null> {
        if (this.cancelRetiredTemplate(job)) return null;
        return this.smsTriggerDeliveryService.prepareJob(job);
    }

    async sendPreparedJob(
        job: MessageTriggerJobEntity,
        preparation: SmsTriggerDeliveryPreparation,
    ): Promise<boolean> {
        if (this.cancelRetiredTemplate(job)) return false;
        return this.smsTriggerDeliveryService.sendPreparedJob(job, preparation);
    }

    private cancelRetiredTemplate(job: MessageTriggerJobEntity): boolean {
        if (!isRetiredFixedEventTemplate(job.templateKey)) return false;
        job.cancel("삭제된 고정 이벤트 템플릿");
        return true;
    }
}
