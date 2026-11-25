import { matchesInitialDocument, type InitialNoProviderDocumentProjection, type InitialRegenerationProjection } from "@/lib/eformsign/initial-document-recovery-contract";
import type { InitialDocumentRecoveryProjections } from "@/services/eformsign";

import { initialDocumentStateLabel } from "./failure-popup-copy";
import { initialRegenerationBlockedCopy } from "./service-record-recovery-copy";

interface InitialDocumentRecoveryItem {
  stateId: string;
  regeneration?: InitialRegenerationProjection;
  confirmation?: InitialNoProviderDocumentProjection;
}

export function initialDocumentRecoveryItems(projections?: InitialDocumentRecoveryProjections | null): InitialDocumentRecoveryItem[] {
  const items = new Map<string, InitialDocumentRecoveryItem>();
  for (const regeneration of projections?.initialRegenerations ?? []) {
    if (!regeneration.ready && !initialRegenerationBlockedCopy(regeneration.reasonCode)
        && !initialDocumentStateLabel(regeneration.reasonCode)) continue;
    const { stateId } = regeneration;
    items.set(stateId, { stateId, regeneration });
  }
  for (const confirmation of projections?.noProviderDocumentConfirmable ?? []) {
    const { stateId } = confirmation;
    const regeneration = items.get(stateId)?.regeneration;
    if (regeneration && !matchesInitialDocument(regeneration, confirmation)) continue;
    items.set(stateId, { stateId, regeneration, confirmation });
  }
  return [...items.values()];
}
