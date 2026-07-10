import {
    PAST_OCCURRENCE_GRACE_MS,
    SEND_HOUR_KST,
    SMS_DELIVERY_MAX_ATTEMPTS,
    SMS_DELIVERY_RETRY_DELAY_MS,
    TRIGGER_DISPATCH_CRON,
    TRIGGER_JOB_CONFIG_RETRY_DELAY_MS,
    TRIGGER_JOB_MAX_ATTEMPTS,
    TRIGGER_JOB_PROCESSING_RECLAIM_MS,
    TRIGGER_JOB_RETRY_DELAY_MS,
} from "domain/constants/message-automation-policy";
import { IsArray, IsInt, IsString, Max, Min } from "class-validator";
import {
    getServiceFeedbackLinkScheduledFor,
    getServiceFeedbackTokenExpiresAt,
    SERVICE_FEEDBACK_LINK_RULE_ID,
    SERVICE_FEEDBACK_LINK_SMS_AUTOMATION_KEY,
    SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
    SERVICE_FEEDBACK_LINK_SMS_TITLE,
    SERVICE_FEEDBACK_LINK_SMS_TRIGGER_TYPE,
} from "domain/constants/service-feedback-link-message";
import {
    DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
    MessageAutomationPastTriggerConfig,
} from "domain/entities/system-setting.entity";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const REFERENCE_SERVICE_DATE = new Date("2026-01-01T00:00:00.000Z");

export interface MessageAutomationPolicyRowDto {
    id: string;
    label: string;
    value: string;
}

export interface MessageAutomationPolicyDto {
    id: string;
    title: string;
    description: string;
    active: boolean;
    requiresApproval: boolean;
    rows: MessageAutomationPolicyRowDto[];
}

export class MessageAutomationPastTriggerConfigDto {
    sendIntervalMinutes!: number;
    ruleOrder!: string[];

    static from(
        config: MessageAutomationPastTriggerConfig,
    ): MessageAutomationPastTriggerConfigDto {
        const dto = new MessageAutomationPastTriggerConfigDto();
        dto.sendIntervalMinutes = config.sendIntervalMinutes;
        dto.ruleOrder = config.ruleOrder;
        return dto;
    }
}

export class UpdateMessageAutomationPastTriggerConfigDto {
    @IsInt()
    @Min(1)
    @Max(1440)
    sendIntervalMinutes!: number;

    @IsArray()
    @IsString({ each: true })
    ruleOrder!: string[];
}

export class MessageAutomationPoliciesResponseDto {
    policies!: MessageAutomationPolicyDto[];
    pastTriggerConfig!: MessageAutomationPastTriggerConfigDto;

    static from(
        pastTriggerConfig: MessageAutomationPastTriggerConfig = DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
    ): MessageAutomationPoliciesResponseDto {
        return MessageAutomationPoliciesResponseDto.build(pastTriggerConfig);
    }

    static build(
        pastTriggerConfig: MessageAutomationPastTriggerConfig = DEFAULT_MESSAGE_AUTOMATION_PAST_TRIGGER_CONFIG,
    ): MessageAutomationPoliciesResponseDto {
        const dto = new MessageAutomationPoliciesResponseDto();
        dto.pastTriggerConfig = MessageAutomationPastTriggerConfigDto.from(pastTriggerConfig);
        dto.policies = [
            {
                id: "trigger-dispatch",
                title: "자동 전송 실행",
                description: "승인된 지점의 자동 전송 잡을 주기적으로 확인하고, 원자적 잡 클레임과 발송 이력 확인으로 중복 발송을 막습니다.",
                active: true,
                requiresApproval: true,
                rows: [
                    {
                        id: "dispatch-interval",
                        label: "실행 주기",
                        value: `${formatCronIntervalMinutes(TRIGGER_DISPATCH_CRON)}마다`,
                    },
                    {
                        id: "duplicate-protection",
                        label: "중복 방지",
                        value: "원자적 잡 클레임 + 발송 이력 확인",
                    },
                    {
                        id: "send-time",
                        label: "발송 시각",
                        value: `${formatKstHour(SEND_HOUR_KST)} KST`,
                    },
                ],
            },
            {
                id: "trigger-job-retry",
                title: "자동 전송 재시도",
                description: "자동 전송 처리 중 일시 오류가 발생하면 정해진 간격으로 재시도하고, 발신 프로필 같은 설정 미비는 별도 간격으로 다시 확인합니다.",
                active: true,
                requiresApproval: true,
                rows: [
                    {
                        id: "retry-delay",
                        label: "일시 오류 재시도",
                        value: `${formatMinutes(TRIGGER_JOB_RETRY_DELAY_MS)} 후`,
                    },
                    {
                        id: "max-attempts",
                        label: "최대 시도 횟수",
                        value: `최대 ${TRIGGER_JOB_MAX_ATTEMPTS}회`,
                    },
                    {
                        id: "config-retry-delay",
                        label: "설정 미비 재확인",
                        value: `${formatMinutes(TRIGGER_JOB_CONFIG_RETRY_DELAY_MS)} 후`,
                    },
                    {
                        id: "processing-reclaim",
                        label: "처리중 작업 회수",
                        value: `${formatMinutes(TRIGGER_JOB_PROCESSING_RECLAIM_MS)} 후`,
                    },
                ],
            },
            {
                id: "sms-retry",
                title: "SMS 재시도",
                description: "재시도 가능한 SMS 발송 로그는 자동 전송과 수동 발송 모두 같은 정책으로 다시 처리합니다.",
                active: true,
                requiresApproval: false,
                rows: [
                    {
                        id: "max-attempts",
                        label: "최대 시도 횟수",
                        value: `최대 ${SMS_DELIVERY_MAX_ATTEMPTS}회`,
                    },
                    {
                        id: "retry-delay",
                        label: "재시도 간격",
                        value: `${formatMinutes(SMS_DELIVERY_RETRY_DELAY_MS)} 후`,
                    },
                    {
                        id: "coverage",
                        label: "적용 범위",
                        value: "자동/수동 SMS 발송 로그",
                    },
                ],
            },
            {
                id: "past-trigger",
                title: "지난 자동 전송 처리",
                description: "예정 시각이 기준 시간을 넘긴 자동 전송은 다시 만들거나 발송하지 않습니다.",
                active: true,
                requiresApproval: true,
                rows: [
                    {
                        id: "grace-window",
                        label: "지난 예정 기준",
                        value: `${formatHours(PAST_OCCURRENCE_GRACE_MS)} 이상`,
                    },
                    {
                        id: "handling",
                        label: "처리 방식",
                        value: "재생성/발송 안 함",
                    },
                ],
            },
            {
                id: "service-feedback-link",
                title: "제공기록지 링크 자동 발송",
                description: "주 담당 제공인력에게 제공기록지 작성 링크 SMS를 예약 발송하고, 수동 발송은 즉시 처리합니다.",
                active: true,
                requiresApproval: true,
                rows: [
                    {
                        id: "message-title",
                        label: "문자 제목",
                        value: SERVICE_FEEDBACK_LINK_SMS_TITLE,
                    },
                    {
                        id: "trigger-type",
                        label: "트리거 유형",
                        value: SERVICE_FEEDBACK_LINK_SMS_TRIGGER_TYPE,
                    },
                    {
                        id: "scheduled-for",
                        label: "예약 발송",
                        value: `서비스 시작일 ${formatKstDateHour(getServiceFeedbackLinkScheduledFor(REFERENCE_SERVICE_DATE))} KST`,
                    },
                    {
                        id: "token-expires-at",
                        label: "링크 만료",
                        value: `서비스 종료일 ${formatKstDateHour(getServiceFeedbackTokenExpiresAt(REFERENCE_SERVICE_DATE))} KST`,
                    },
                    {
                        id: "rule-id",
                        label: "규칙 ID",
                        value: SERVICE_FEEDBACK_LINK_RULE_ID,
                    },
                    {
                        id: "automation-key",
                        label: "자동화 키",
                        value: SERVICE_FEEDBACK_LINK_SMS_AUTOMATION_KEY,
                    },
                    {
                        id: "template-key",
                        label: "문자 로그 템플릿",
                        value: SERVICE_FEEDBACK_LINK_SMS_LOG_TEMPLATE_KEY,
                    },
                ],
            },
        ];

        return dto;
    }
}

function formatMinutes(ms: number): string {
    return `${ms / MS_PER_MINUTE}분`;
}

function formatHours(ms: number): string {
    return `${ms / MS_PER_HOUR}시간`;
}

function formatCronIntervalMinutes(cron: string): string {
    const minuteExpression = cron.split(" ")[0] ?? "";
    const interval = Number(minuteExpression.replace("*/", ""));
    return `${interval}분`;
}

function formatKstHour(hour: number): string {
    return `${String(hour).padStart(2, "0")}:00`;
}

function formatKstDateHour(date: Date): string {
    const hour = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        hourCycle: "h23",
    }).format(date);

    return `${hour}:00`;
}
