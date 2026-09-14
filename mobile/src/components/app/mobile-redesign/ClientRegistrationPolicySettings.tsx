"use client";

import { MessageSquareText, UserPlus } from "lucide-react";

import { SettingsListItem } from "@/components/app/mobile-redesign/settings/SettingsListCard";
import { useClientRegistrationPolicy } from "@/components/app/mobile-redesign/settings/use-client-registration-policy";
import { Switch } from "@/components/ui/switch";

export function ClientRegistrationPolicySettings({
  "data-component": dataComponent,
}: {
  "data-component": string;
}) {
  const { policy, updatePolicy } = useClientRegistrationPolicy();
  const clientAutoRegistrationBase = `${dataComponent}_item-client-auto-registration`;
  const greetingBase = `${dataComponent}_item-greeting-on-auto-registration`;

  return (
    <>
      <SettingsListItem
        data-component={clientAutoRegistrationBase}
        icon={UserPlus}
        title="고객 자동 등록"
        subtitle="eformsign 계약서 도착 시 고객을 자동으로 등록합니다."
        showChevron={false}
        control={(
          <Switch
            data-component={`${clientAutoRegistrationBase}_trailing_switch`}
            thumbDataComponent={`${clientAutoRegistrationBase}_trailing_switch_thumb`}
            aria-label="eformsign 계약서 도착 시 고객 자동 등록"
            checked={policy?.clientAutoRegistration === true}
            disabled={!policy || updatePolicy.isPending}
            className="[--v3-ui-scale:var(--glint-ui-scale,1)]"
            onCheckedChange={(checked) => updatePolicy.mutate({ clientAutoRegistration: checked })}
          />
        )}
      />
      <SettingsListItem
        data-component={greetingBase}
        icon={MessageSquareText}
        title="인사 문자 자동 발송"
        subtitle="고객 자동 등록 후 인사 문자를 발송합니다."
        showChevron={false}
        control={(
          <Switch
            data-component={`${greetingBase}_trailing_switch`}
            thumbDataComponent={`${greetingBase}_trailing_switch_thumb`}
            aria-label="자동 등록 시 인사 문자 발송"
            checked={policy?.greetingOnAutoRegistration === true}
            disabled={!policy?.clientAutoRegistration || updatePolicy.isPending}
            className="[--v3-ui-scale:var(--glint-ui-scale,1)]"
            onCheckedChange={(checked) => updatePolicy.mutate({ greetingOnAutoRegistration: checked })}
          />
        )}
      />
    </>
  );
}
