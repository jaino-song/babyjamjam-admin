"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/app/lib/axios";

// Types
export interface BankAccountInfo {
  area: string;
  bankName: string;
  accNum: string;
}

export interface VoucherPriceInfo {
  id: number;
  type: string;
  duration: string;
  fullPrice: number;
  grant: number;
  actualPrice: number;
}

// Query keys - centralized for consistency
export const voucherQueryKeys = {
  bankAccountInfos: ["bank-account-infos"] as const,
  voucherPriceInfos: (type: string) => ["voucher-price-infos", type] as const,
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

