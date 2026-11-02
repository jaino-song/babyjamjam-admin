/**
 * @deprecated Use SystemTemplate from database instead.
 * This file is kept as fallback only.
 * See: /system-templates API and useSystemTemplate hook
 * 
 * To edit this template, go to: /messages/system-templates
 */

interface ContractReminderMessageData {
  name: string;
}

export const contractReminderMsgTemplate = (data: ContractReminderMessageData): string => 
    `[사회서비스 제공자 품질평가 A등급]
안녕하세요, 인천 아이미래로 입니다 :)

${data.name} 산모님~♡ 

서비스 계약서가 아직 완료되지 않아 연락드립니다.

서비스 계약서는 서비스 진행을 위해 꼭 필요합니다. 계약서가 작성되지 않으면 서비스 제공에 차질이 생길 수 있으니, 서비스 시작일 전에 꼭 작성 및 서명 완료를 부탁드립니다. 추가적으로, 본인부담금 환급 신청을 위한 영수증 발급도 계약서가 완료되어야만 발급이 가능하니 꼭 빠른 시간 내에 계약서 작성 및 서명 완료를 부탁드립니다 :)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`;
