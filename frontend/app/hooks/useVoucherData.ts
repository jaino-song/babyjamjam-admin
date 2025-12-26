"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/axios/client";

// Types
export interface BankAccountInfo {
  area: string;
  bankName: string;
  accNum: string;
}

export interface VoucherPriceInfo {
  id: number;
  type: string | null;
  duration: string;
  fullPrice: string | null;
  grant: string | null;
  actualPrice: string | null;
}

export interface AreaTemplate {
  area: string;
  templateId: string;
  templateName: string | null;
}

// Query keys - centralized for consistency
export const voucherQueryKeys = {
  bankAccountInfos: ["bank-account-infos"] as const,
  voucherPriceInfos: (type: string) => ["voucher-price-infos", type] as const,
  areaTemplates: ["area-templates"] as const,
};

// Hooks
export function useBankAccountInfos() {
  return useQuery<BankAccountInfo[]>({
    queryKey: voucherQueryKeys.bankAccountInfos,
    queryFn: async () => {
      const { data } = await api.get("/bank-account-infos");
      return data as BankAccountInfo[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export function useVoucherPriceInfos(type: string) {
  return useQuery<VoucherPriceInfo[]>({
    queryKey: voucherQueryKeys.voucherPriceInfos(type),
    queryFn: async () => {
      const { data } = await api.get("/voucher-price-infos/type", {
        params: { type },
      });
      return data as VoucherPriceInfo[];
    },
    enabled: !!type,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

export function useAreaTemplates() {
  return useQuery<AreaTemplate[]>({
    queryKey: voucherQueryKeys.areaTemplates,
    queryFn: async () => {
      const { data } = await api.get("/area-templates");
      return data as AreaTemplate[];
    },
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24, // 24 hours
  });
}

