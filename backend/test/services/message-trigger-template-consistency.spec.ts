import { SMS_TEMPLATE_DELIVERY } from "application/services/sms-trigger-delivery.service";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";

describe("SMS trigger template consistency", () => {
    it.each(
        Object.values(MESSAGE_TRIGGER_TEMPLATE_CATALOG)
            .filter((item) => item.providers.sms)
            .map((item) => [item.key, item] as const),
    )("keeps catalog, delivery config, registry, and variables aligned for %s", (templateKey, catalogItem) => {
        const delivery = SMS_TEMPLATE_DELIVERY[templateKey as MessageTriggerTemplateKey];
        expect(delivery).toBeDefined();

        const systemTemplateKey = delivery?.systemTemplateKey;
        expect(systemTemplateKey).toBeDefined();
        const registryEntry = systemTemplateKey ? SYSTEM_TEMPLATE_REGISTRY[systemTemplateKey] : undefined;
        expect(registryEntry).toBeDefined();

        const availableVariables = new Set(
            Array.from(
                registryEntry?.defaultContent.matchAll(/\{\{\s*(\w+)\s*\}\}/g) ?? [],
                (match) => match[1],
            ),
        );
        const missingVariables = catalogItem.requiredVariables
            .map((variable) => variable.key)
            .filter((key) => !availableVariables.has(key));
        expect(missingVariables).toEqual([]);
    });
});
