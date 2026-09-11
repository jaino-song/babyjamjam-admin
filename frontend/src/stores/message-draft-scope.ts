import { useFormStore } from "./form-store";
import { useTemplateStore } from "./template-store";

let lastScopedBranchId: string | null | undefined;

/**
 * Manual message inputs are held in singleton Zustand stores because the
 * legacy forms share fields while a user moves between template tabs. Reset
 * those drafts when the authenticated branch changes so a previous branch's
 * recipient, variables, or message edits cannot be reused under the new
 * session. Repeated calls for the same branch preserve valid in-branch edits.
 */
export function syncMessageDraftScope(branchId: string | null): void {
  if (lastScopedBranchId === branchId) return;

  useFormStore.getState().resetAll();
  useTemplateStore.getState().resetVariableValues();
  lastScopedBranchId = branchId;
}
