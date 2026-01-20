/**
 * @deprecated Use SystemTemplate from database instead.
 * This file is kept as fallback only.
 * See: /system-templates API and useSystemTemplate hook
 * 
 * To edit this template, go to: /messages/system-templates
 */

interface PriceInfoMessageData {
  name: string;
  weeks: number;
  duration: string;
  type: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  bankName: string;
  accNum: string;
}

export const priceInfoMsgTemplate = (data: PriceInfoMessageData): string => 
`[사회서비스 제공자 품질평가 A등급]

${data.name} 산모님~♡ 

정부지원 바우처 서비스 비용 관련해서 안내 드립니다 :)

서비스 기간: 
출퇴근 ${data.weeks}주 (평일기준 ${data.duration}일)
정부지원 바우처 유형: 
${data.type}

기본 서비스 금액은 
총 ${data.fullPrice}원이며, 
정부 지원금액은 
${data.grant}원 입니다.

산모님께서 부담하시는 금액은 
${data.actualPrice}원 입니다.

서비스 예약을 위해 
선납하실 예약금은 
100,000원 입니다.

예약금 입금 후에 
서비스 예약이 확정 됩니다.

입금 계좌번호: 
${data.bankName} ${data.accNum}
예금주: 인천 아이미래로 (김정인)

입금시 입금자명을 꼭 기재해 주세요 :)
(타인 계좌에서 송금시 산모님 성함 기재 필수)

아기의 건강과 엄마의 안정을 위해 최선을 다하겠습니다. 감사합니다.`;