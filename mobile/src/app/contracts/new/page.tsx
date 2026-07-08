"use client";

import { ContractCreationScreen } from "@/components/app/contracts";
import { useContractCreationFlow } from "@/hooks/contracts/useContractCreationFlow";

export default function ContractCreationPage() {
  const flow = useContractCreationFlow();

  return <ContractCreationScreen flow={flow} />;
}
