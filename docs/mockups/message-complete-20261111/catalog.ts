import { greetingMsgTemplate } from '@/components/app/messages/templates/messageTemplate/greetingMsg';
import { serviceInfoMsgTemplate } from '@/components/app/messages/templates/messageTemplate/serviceInfoMsg';
import { priceInfoMsgTemplate } from '@/components/app/messages/templates/messageTemplate/priceInfoMsg';
import { reminderMsgTemplate } from '@/components/app/messages/templates/messageTemplate/reminderMsg';
import { thanksMsgTemplate } from '@/components/app/messages/templates/messageTemplate/thanksMsg';
import { infoMsgTemplate } from '@/components/app/messages/templates/messageTemplate/infoMsg';
import { contractReminderMsgTemplate } from '@/components/app/messages/templates/messageTemplate/contractReminderMsg';
import { surveyMsgTemplate } from '@/components/app/messages/templates/messageTemplate/surveyMsg';
import voucher from '@/components/app/messages/templates/json/voucher.json';

export interface SampleTemplate {
  id: string;
  label: string;
  body: string;
}

// Offline fallback samples, never a simulated response from the server-owned catalog.
// Labels include the requested preview revisions. Greeting has no invented name variable.
export const SAMPLE_TEMPLATES: readonly SampleTemplate[] = [
  { id: 'GREETING', label: '첫 인사', body: greetingMsgTemplate() },
  { id: 'SERVICE_INFO', label: '서비스 내용', body: serviceInfoMsgTemplate({ name: '{{name}}' }) },
  { id: 'PRICE_INFO', label: '비용 안내', body: priceInfoMsgTemplate({
    name: '{{name}}', weeks: 0, duration: '{{duration}}', type: '{{type}}',
    fullPrice: '{{fullPrice}}', grant: '{{grant}}', actualPrice: '{{actualPrice}}',
    bankName: '{{bankName}}', accNum: '{{accNum}}',
  }).replace('출퇴근 0주', '출퇴근 {{weeks}}주') },
  { id: 'REMINDER', label: '리마인드', body: reminderMsgTemplate({ name: '{{name}}' }) },
  { id: 'THANKS', label: '입금 확인 및 예약 완료 안내', body: thanksMsgTemplate({ name: '{{name}}' }) },
  { id: 'INFO', label: '산모 정보 요청', body: infoMsgTemplate() },
  { id: 'CONTRACT_REMINDER', label: '계약서 작성 요청', body: contractReminderMsgTemplate({ name: '{{name}}' }) },
  { id: 'SURVEY', label: '모니터링 설문', body: surveyMsgTemplate({ name: '{{name}}' }) },
  { id: '__custom__', label: '직접 작성', body: '' },
];

export const VARIABLE_LABELS: Record<string, string> = {
  name: '산모님 성함', weeks: '서비스 주수', duration: '서비스 기간', type: '바우처 유형',
  fullPrice: '총 서비스 금액', grant: '정부지원금', actualPrice: '본인부담금',
  bankName: '은행명', accNum: '계좌번호',
};

export const VOUCHER_GROUPS = Object.entries(voucher.voucherOptions);
interface VoucherType { label: string; durations: Record<string, { weeks: number; id: number }> }
export function findVoucherType(type: string): VoucherType | undefined {
  for (const [, types] of VOUCHER_GROUPS) {
    const match = Object.entries(types).find(([key]) => key === type);
    if (match) return match[1];
  }
}

export const SAMPLE_AREAS = [
  { area: 'QA-예시지역 A', bankName: 'QA-예시은행', accNum: '000-0000-0000' },
  { area: 'QA-예시지역 B', bankName: 'QA-샘플은행', accNum: '000-0000-0001' },
] as const;
export const YEARS = ['2025', '2026', '2027'] as const;

export function getSamplePrices(duration: string, year: string): Record<string, string> {
  if (!duration) return {};
  // Deliberately fictional preview arithmetic, not a voucher price table.
  const full = Number(duration) * (100_000 + (Number(year) - 2025) * 1_000);
  const grant = Math.round(full * 0.7);
  const format = (value: number) => new Intl.NumberFormat('ko-KR').format(value);
  return { fullPrice: format(full), grant: format(grant), actualPrice: format(full - grant) };
}

export function renderSampleBody(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (token, key: string) => values[key]?.trim() || token);
}
