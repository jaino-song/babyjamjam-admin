"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  settingsApi,
  type ClientRegistrationPolicy,
  type ClientRegistrationPolicyPatch,
} from "@/services/api";

const QUERY_KEY = ["settings", "client-registration-policy"] as const;

export function ClientRegistrationPolicySettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: policy } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: settingsApi.getClientRegistrationPolicy,
  });
  const updatePolicy = useMutation({
    mutationFn: settingsApi.updateClientRegistrationPolicy,
    onMutate: async (patch: ClientRegistrationPolicyPatch) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<ClientRegistrationPolicy>(QUERY_KEY);
      queryClient.setQueryData<ClientRegistrationPolicy>(QUERY_KEY, (current) =>
        current ? { ...current, ...patch } : current,
      );
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
      toast({ variant: "destructive", description: "고객 자동 등록 설정 저장 중 오류가 발생했습니다." });
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(QUERY_KEY, saved);
      toast({ description: "고객 자동 등록 설정이 저장되었습니다." });
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return (
    <div className="section-block" data-component="mobile_messages_client-registration-policy">
      <div className="section-header">고객 자동 등록</div>
      <div className="list-item">
        <div className="trigger-info">
          <div className="trigger-title">전자문서 생성 시 고객 자동 등록</div>
        </div>
        <Switch
          aria-label="전자문서 생성 시 고객 자동 등록"
          checked={policy?.clientAutoRegistration === true}
          disabled={!policy || updatePolicy.isPending}
          onCheckedChange={(checked) => updatePolicy.mutate({ clientAutoRegistration: checked })}
        />
      </div>
      <div className="list-item">
        <div className="trigger-info">
          <div className="trigger-title">자동 등록 시 인사 문자 발송</div>
        </div>
        <Switch
          aria-label="자동 등록 시 인사 문자 발송"
          checked={policy?.greetingOnAutoRegistration === true}
          disabled={!policy?.clientAutoRegistration || updatePolicy.isPending}
          onCheckedChange={(checked) => updatePolicy.mutate({ greetingOnAutoRegistration: checked })}
        />
      </div>
    </div>
  );
}
