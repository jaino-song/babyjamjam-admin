import { MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import {
    SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY,
    SERVICE_END_NOTICE_PREVIEW_RECEIPT_URL,
    SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE,
} from "domain/constants/service-end-notice-message";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

/**
 * A throwaway comparison/preview view of a SERVICE_END_NOTICE job with its
 * enricher-owned receiptUrl/buttonUrl forced to a fixed placeholder. A no-op
 * for every other template. Idempotent: applying it more than once (or to a
 * job that already carries the placeholder) is safe and produces the same
 * result, so callers never need to coordinate about who already applied it.
 *
 * BJJ-342 M1: `ReceiptLinkDeliveryEnricher` writes the real receipt link only
 * at real delivery time. Every OTHER render of a SERVICE_END_NOTICE job or
 * recipe -- a preview, a materialize/dispatch authority comparison, an impact
 * summary -- happens before that link exists (or must render a fresh
 * recipe, which never carries it at all), yet the system template
 * (system-template-registry.ts) requires `receiptUrl`. Without this
 * substitution, `SmsTriggerDeliveryService.resolveCanonicalDeliverySnapshot`
 * throws `MissingSmsTemplateVariablesError` for every such render.
 *
 * Applied inside `describeClientMessageEffect` (client-message-effect-recipe.ts),
 * on the recipe-built entity it renders internally -- this is what makes
 * BOTH of its callers correct without their own patch:
 *  - `client-automation-impact.service.ts`'s impact-preview calls (which
 *    render directly against the real `SmsTriggerDeliveryService`, no
 *    wrapper of their own).
 *  - `agent-automation-job-authority.service.ts`'s `describeCurrentClientEffect`,
 *    via the `resolveCanonicalDeliverySnapshot` it hands in.
 * Also applied directly by `describeCurrentClientEffect` to the actual
 * stored/candidate job it renders itself -- a render `describeClientMessageEffect`
 * does not control, since that job is not the recipe it built.
 *
 * Never applied to the REAL delivery path: `agent-automation-delivery-gate.service.ts`'s
 * canonical dispatch-time render, and `sms-trigger-delivery.service.ts`'s
 * send/prepare paths, still render and hash the real, enricher-issued link.
 */
export function withServiceEndNoticePreviewLink(job: MessageTriggerJobEntity): MessageTriggerJobEntity {
    if (job.templateKey !== MessageTriggerTemplateKey.SERVICE_END_NOTICE) return job;
    return job.withPayloadOverride({
        templateVariables: {
            ...job.payload.templateVariables,
            [SERVICE_END_NOTICE_RECEIPT_URL_TEMPLATE_VARIABLE]: SERVICE_END_NOTICE_PREVIEW_RECEIPT_URL,
        },
        [SERVICE_END_NOTICE_BUTTON_URL_PAYLOAD_KEY]: SERVICE_END_NOTICE_PREVIEW_RECEIPT_URL,
    });
}
