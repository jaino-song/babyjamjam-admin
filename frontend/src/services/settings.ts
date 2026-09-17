import { api } from "@/lib/api/client";

export type MessageSenderApprovalStatus = "not_requested" | "pending" | "approved";

export interface MessageSenderApprovalResponse {
    approvalStatus: MessageSenderApprovalStatus;
    isApproved: boolean;
    canRequest: boolean;
    requestedAt: string | null;
    approvedAt: string | null;
}

export interface MessageAutomationPolicyRow {
    id: string;
    label: string;
    value: string;
}

export interface MessageAutomationPolicy {
    id: string;
    title: string;
    description: string;
    active: boolean;
    requiresApproval: boolean;
    rows: MessageAutomationPolicyRow[];
}

export interface MessageAutomationPastTriggerConfig {
    sendIntervalMinutes: number;
    ruleOrder: string[];
}

export interface MessagePolicyActivationResponse {
    policyId: "trigger-dispatch";
    enabled: boolean;
}

export interface ClientRegistrationPolicyAutomationStatus {
    /** 웹훅 수신이 가능한 상태인지 (시크릿 + 테넌트 허용목록 존재). */
    webhookConfigured: boolean;
    /** 6시간 주기 미러 동기화가 활성화되어 있는지. */
    sweepEnabled: boolean;
    /** 주기 동기화가 실제로 시작될 수 있는지 (락 또는 단일 인스턴스 승인). */
    sweepRunnable: boolean;
    /** 최근 24시간 수신한 웹훅 건수. 구버전 백엔드 응답에는 없다. */
    webhookReceived24h?: number;
    /** 그중 아무것도 반영하지 못한 건수. 설정 여부와 달리 실제 동작을 말해준다. */
    webhookDropped24h?: number;
}

export interface ClientRegistrationPolicy {
    clientAutoRegistration: boolean;
    greetingOnAutoRegistration: boolean;
    /** 구버전 백엔드 응답에는 없을 수 있다. */
    automation?: ClientRegistrationPolicyAutomationStatus;
}

export type ClientRegistrationPolicyPatch = Partial<ClientRegistrationPolicy>;

export interface MessageAutomationPoliciesResponse {
    policies: MessageAutomationPolicy[];
    pastTriggerConfig: MessageAutomationPastTriggerConfig;
    /** Resolved current-branch owner/admin capability for activation mutations. */
    canManageActivation?: boolean;
    policyActivations?: Partial<Record<
        | "trigger-dispatch"
        | "trigger-job-retry"
        | "sms-retry"
        | "past-trigger"
        | "service-feedback-link"
        | "duplicate-send-confirmation",
        boolean
    >>;
}

export interface ContractAutoFinalizeConfig {
    enabled: boolean;
    graceDays: number;
    maxAttempts: number;
}

export interface ContractAutomationPoliciesResponse {
    autoFinalize: ContractAutoFinalizeConfig;
}

export interface NotificationPreferencesResponse {
    emailNotificationsEnabled: boolean;
    updatedAt?: string;
}

export interface RibbonConfig {
    enabled: boolean;
    message: string;
    backgroundColor: string;
    textColor: string;
    linkText: string;
    linkHref: string;
    linkColor: string;
}

export interface RibbonConfigResponse extends RibbonConfig {
    updatedAt?: string;
}

export const settingsApi = {
    getClientRegistrationPolicy: async (): Promise<ClientRegistrationPolicy> => {
        const { data } = await api.get("/settings/client-registration-policy");
        return data;
    },
    updateClientRegistrationPolicy: async (
        patch: ClientRegistrationPolicyPatch,
    ): Promise<ClientRegistrationPolicy> => {
        const { data } = await api.put("/settings/client-registration-policy", patch);
        return data;
    },
    getMessageSenderApproval: async (): Promise<MessageSenderApprovalResponse> => {
        const { data } = await api.get("/settings/message-sender-approval");
        return data;
    },
    getMessageAutomationPolicies: async (): Promise<MessageAutomationPoliciesResponse> => {
        const { data } = await api.get("/settings/message-automation-policies");
        return data;
    },
    getContractAutomationPolicies: async (): Promise<ContractAutomationPoliciesResponse> => {
        const { data } = await api.get("/settings/contract-automation-policies");
        return data;
    },
    updateContractAutoFinalizeConfig: async (
        config: ContractAutoFinalizeConfig,
    ): Promise<ContractAutoFinalizeConfig> => {
        const { data } = await api.put("/settings/contract-automation-policies/auto-finalize", config);
        return data;
    },
    updateMessageAutomationPastTriggerConfig: async (
        config: MessageAutomationPastTriggerConfig,
    ): Promise<MessageAutomationPastTriggerConfig> => {
        const { data } = await api.put("/settings/message-automation-policies/past-trigger", config);
        return data;
    },
    updateMessagePolicyActivation: async (
        enabled: boolean,
    ): Promise<MessagePolicyActivationResponse> => {
        const { data } = await api.put(
            "/settings/message-policy-activations/trigger-dispatch",
            { enabled },
        );
        return data;
    },
    requestMessageSenderApproval: async (): Promise<MessageSenderApprovalResponse> => {
        const { data } = await api.post("/settings/message-sender-approval/request");
        return data;
    },
    getNotificationPreferences: async (): Promise<NotificationPreferencesResponse> => {
        const { data } = await api.get('/settings/notification-preferences');
        return data;
    },
    updateNotificationPreferences: async (emailNotificationsEnabled: boolean): Promise<NotificationPreferencesResponse> => {
        const { data } = await api.put('/settings/notification-preferences', { emailNotificationsEnabled });
        return data;
    },
    getRibbonConfig: async (): Promise<RibbonConfigResponse> => {
        const { data } = await api.get('/settings/ribbon-config');
        return data;
    },
    updateRibbonConfig: async (config: RibbonConfig): Promise<RibbonConfigResponse> => {
        const { data } = await api.put('/settings/ribbon-config', config);
        return data;
    },
}
