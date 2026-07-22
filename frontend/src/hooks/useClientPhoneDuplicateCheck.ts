import { usePhoneDuplicateCheck } from "@/hooks/usePhoneDuplicateCheck";

interface UseClientPhoneDuplicateCheckParams {
  phone: string | null | undefined;
  originalPhone?: string | null;
  enabled?: boolean;
}

export function useClientPhoneDuplicateCheck(
  params: UseClientPhoneDuplicateCheckParams,
) {
  return usePhoneDuplicateCheck({
    ...params,
    endpoint: "/clients/check-phone",
  });
}
