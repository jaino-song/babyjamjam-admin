export const STORED_MESSAGE_SETTINGS_POLICY_IDS = [
    "trigger-dispatch",
    "trigger-job-retry",
    "sms-retry",
    "past-trigger",
    "duplicate-send-confirmation",
] as const;

export type StoredMessageSettingsPolicyId = (typeof STORED_MESSAGE_SETTINGS_POLICY_IDS)[number];

export const DEFAULT_MESSAGE_SETTINGS_POLICY_ENABLED = true;
