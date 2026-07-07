type EformsignWorkflowStatus = {
  step_type?: string | null;
  step_name?: string | null;
};

const PROVIDER_REVIEW_STEP_TYPES = new Set(["06"]);
const PROVIDER_REVIEW_OWNER_KEYWORDS = ["제공기관", "관리자", "담당자"];
const PROVIDER_REVIEW_ACTION_KEYWORDS = ["확인", "검토"];
const CUSTOMER_STEP_KEYWORDS = ["이용자", "고객", "산모"];

export function isProviderReviewWorkflowStep(
  currentStatus: EformsignWorkflowStatus | null | undefined,
): boolean {
  const stepType = currentStatus?.step_type?.trim() ?? "";
  const stepName = currentStatus?.step_name?.trim() ?? "";

  if (PROVIDER_REVIEW_STEP_TYPES.has(stepType)) return true;
  if (!stepName) return false;
  if (CUSTOMER_STEP_KEYWORDS.some((keyword) => stepName.includes(keyword))) return false;

  const hasProviderOwner = PROVIDER_REVIEW_OWNER_KEYWORDS.some((keyword) => stepName.includes(keyword));
  const hasReviewAction = PROVIDER_REVIEW_ACTION_KEYWORDS.some((keyword) => stepName.includes(keyword));
  return hasProviderOwner && hasReviewAction;
}
