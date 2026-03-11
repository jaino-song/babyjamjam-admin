import { AligoTemplateKey, ALIGO_TEMPLATES } from "./alimtalk-template.dto";

export interface SendAligoAlimtalkDto {
    templateKey: AligoTemplateKey;
    receiver: string;
    variables: Record<string, string>;
    buttonUrl?: string;
    organizationId?: string;
    clientId?: number;
    triggerJobId?: string;
}

export class AligoMessageBuilder {
    static buildMessage(templateKey: AligoTemplateKey, variables: Record<string, string>): string {
        const template = ALIGO_TEMPLATES[templateKey];
        let message = this.getMessageTemplate(templateKey);

        for (const variable of template.variables) {
            const value = variables[variable] || "";
            message = message.replace(`#{${variable}}`, value);
        }

        return message;
    }

    private static getMessageTemplate(templateKey: AligoTemplateKey): string {
        const templates: Record<AligoTemplateKey, string> = {
            CLIENT_CREATED: `[아이미래 인천]
#{고객명}님, 등록이 완료되었습니다.

등록일: #{등록일}
서비스: #{서비스타입}

문의사항은 채널톡으로 연락주세요.`,

            SERVICE_START_REMINDER: `[아이미래 인천]
#{고객명}님, #{발송기준}입니다.

서비스 시작일: #{서비스시작일}

준비사항이나 문의사항이 있으시면 연락주세요.`,

            SERVICE_END_REMINDER: `[아이미래 인천]
#{고객명}님, #{발송기준}입니다.

서비스 종료일: #{서비스종료일}

필요한 사항이 있으면 언제든지 연락주세요.`,

            EMPLOYEE_ASSIGNED: `[아이미래 인천]
#{직원명}님, 새로운 배정이 등록되었습니다.

고객명: #{고객명}
서비스 시작일: #{서비스시작일}

세부 내용을 확인해 주세요.`,

            CONTRACT_SIGNED: `[아이미래 인천]
#{고객명}님, 계약이 완료되었습니다.

계약 유형: #{계약유형}
계약일: #{계약일}
서비스 시작일: #{서비스시작일}
담당자: #{담당자명}

감사합니다.`,

            CONTRACT_REMINDER_3DAYS: `[아이미래 인천]
#{고객명}님, 서비스 시작 3일 전입니다.

서비스 시작일: #{서비스시작일}

준비사항이나 문의사항이 있으시면 연락주세요.`,

            CONTRACT_REMINDER_1DAY: `[아이미래 인천]
#{고객명}님, 내일 서비스가 시작됩니다.

서비스 시작일: #{서비스시작일}

담당자가 방문 예정입니다.`,

            PAYMENT_CONFIRMED: `[아이미래 인천]
#{고객명}님, 결제가 확인되었습니다.

결제 금액: #{결제금액}
결제일: #{결제일}
결제 방법: #{결제방법}
서비스 월: #{서비스월}

감사합니다.`,

            SURVEY_REQUEST: `[아이미래 인천]
#{고객명}님, 서비스는 만족스러우셨나요?

서비스 종료일: #{서비스종료일}
담당자: #{담당자명}

소중한 의견을 남겨주세요:
#{설문링크}`,

            PAYMENT_REMINDER: `[아이미래 인천]
#{고객명}님, 결제 안내드립니다.

등록일: #{등록일}
예상 결제금액: #{예상금액}
결제 기한: #{결제기한}

문의사항은 연락주세요.`,
        };

        return templates[templateKey];
    }

    static buildButtonJson(url: string): string {
        return JSON.stringify({
            button: [
                {
                    name: "확인",
                    linkType: "WL",
                    linkM: url,
                    linkP: url,
                },
            ],
        });
    }
}
