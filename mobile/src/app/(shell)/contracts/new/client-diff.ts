import { normalizeBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";

import voucherOptions from "@/components/app/messages/templates/json/voucher.json";
import { normalizeIsoDate } from "@/lib/contracts/date-input";
import { formatKoreanPhoneNumber } from "@/lib/phone";

// 선택한 기존 고객의 저장값과 계약서 입력값을 비교하기 위한 정규화 값이에요.
// value는 비교용, display는 안내창 표시용이에요. (데스크탑 ContractCreationForm의 비교와 같은 규칙이에요.)
export type ClientDiffKey =
  | "phone"
  | "birthday"
  | "address"
  | "areaId"
  | "primaryEmployeeId"
  | "secondaryEmployeeId"
  | "type"
  | "duration"
  | "fullPrice"
  | "grant"
  | "actualPrice"
  | "startDate"
  | "endDate";

export interface ClientDiffValue {
  value: string | null;
  display: string | null;
}

export type ClientDiffSnapshot = Record<ClientDiffKey, ClientDiffValue>;

export interface ClientDiffRow {
  key: ClientDiffKey;
  label: string;
  oldDisplay: string;
  newDisplay: string;
}

export type ClientDiffDecision = "contract-only" | "update-client" | "cancel";

export interface ClientDiffPrompt {
  rows: ClientDiffRow[];
  showPeriodLockedNote: boolean;
}

export interface LoadedClientBaseline {
  id: number;
  snapshot: ClientDiffSnapshot;
  periodLocked: boolean;
}

export const CLIENT_DIFF_KEYS: readonly ClientDiffKey[] = [
  "phone",
  "birthday",
  "address",
  "areaId",
  "primaryEmployeeId",
  "secondaryEmployeeId",
  "type",
  "duration",
  "fullPrice",
  "grant",
  "actualPrice",
  "startDate",
  "endDate",
];

// 서비스 기록이 확정된 고객은 이 항목을 고객 정보에 저장할 수 없어요.
export const CLIENT_PERIOD_DIFF_KEYS: ReadonlySet<ClientDiffKey> = new Set(["duration", "startDate", "endDate"]);

export const CLIENT_DIFF_EMPTY_DISPLAY = "(없음)";
export const CLIENT_DIFF_PERIOD_LOCKED_NOTE = "서비스 기록이 확정된 고객이라 계약 기간은 계약서에만 반영돼요.";
export const REGISTERED_VALUE_DIFF_HINT = "등록된 정보와 달라요.";

const CLIENT_DIFF_LABELS: Record<ClientDiffKey, string> = {
  phone: "연락처",
  birthday: "생년월일",
  address: "주소",
  areaId: "지역",
  primaryEmployeeId: "제공인력 1",
  secondaryEmployeeId: "제공인력 2",
  type: "바우처 유형",
  duration: "바우처 기간",
  fullPrice: "총 서비스 금액",
  grant: "정부지원금",
  actualPrice: "본인부담금",
  startDate: "시작일",
  endDate: "종료일",
};

// 저장된 고객에서 읽어 오는 값이에요. birthday는 호출하는 쪽이 별칭 필드까지 풀어서 넘겨요.
export interface ClientDiffSource {
  phone: string | null;
  birthday: string | null | undefined;
  address: string | null;
  areaId?: string | null;
  primaryEmployee: { id: number; name: string } | null;
  secondaryEmployee: { id: number; name: string } | null;
  type: string | null;
  duration: number | null;
  fullPrice: string | null;
  grant: string | null;
  actualPrice: string | null;
  startDate: string | null;
  endDate: string | null;
}

// 계약서 입력값이에요. 날짜는 ISO(YYYY-MM-DD), 금액은 쉼표 없는 숫자 문자열이에요.
export interface ClientDiffFormValues {
  phone: string;
  birthday: string;
  address: string;
  areaId: string;
  primaryEmployeeId: number | null;
  primaryEmployeeName: string;
  secondaryEmployeeId: number | null;
  secondaryEmployeeName: string;
  type: string;
  duration: string;
  fullPrice: string;
  grant: string;
  actualPrice: string;
  startDate: string;
  endDate: string;
}

export type AreaDisplayFormatter = (areaId: string) => string;

export function getVoucherTypeLabel(type: string): string {
  for (const types of Object.values(voucherOptions.voucherOptions) as Array<Record<string, { label: string }>>) {
    if (types[type]) return types[type].label;
  }
  return type;
}

function diffText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function diffDate(value: string | null | undefined): string | null {
  return diffText(normalizeIsoDate(value));
}

function diffBirthday(value: string | null | undefined): string | null {
  const trimmed = diffText(value);
  return trimmed ? normalizeBirthdayIsoDate(trimmed) ?? trimmed : null;
}

function diffPrice(value: string | null | undefined): string | null {
  return diffText(value?.replace(/,/g, ""));
}

function diffNumber(value: number | string | null | undefined): string | null {
  return value === null || value === undefined ? null : diffText(String(value));
}

function diffPhone(value: string | null | undefined): ClientDiffValue {
  const trimmed = diffText(value);
  return {
    value: trimmed ? diffText(trimmed.replace(/\D/g, "")) : null,
    display: trimmed ? formatKoreanPhoneNumber(trimmed) : null,
  };
}

function diffValue(value: string | null, display: string | null = value): ClientDiffValue {
  return { value, display };
}

function priceDisplay(value: string | null): string | null {
  const number = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isNaN(number) ? value : `${number.toLocaleString("ko-KR")}원`;
}

function areaDisplay(areaId: string | null, formatArea: AreaDisplayFormatter): string | null {
  return areaId === null ? null : formatArea(areaId);
}

export function buildClientDiffSnapshotFromClient(
  client: ClientDiffSource,
  formatArea: AreaDisplayFormatter,
): ClientDiffSnapshot {
  const duration = diffNumber(client.duration);
  const fullPrice = diffPrice(client.fullPrice);
  const grant = diffPrice(client.grant);
  const actualPrice = diffPrice(client.actualPrice);
  const areaId = diffText(client.areaId);
  const type = diffText(client.type);
  return {
    phone: diffPhone(client.phone),
    birthday: diffValue(diffBirthday(client.birthday)),
    address: diffValue(diffText(client.address)),
    areaId: diffValue(areaId, areaDisplay(areaId, formatArea)),
    primaryEmployeeId: diffValue(
      diffNumber(client.primaryEmployee?.id),
      diffText(client.primaryEmployee?.name) ?? diffNumber(client.primaryEmployee?.id),
    ),
    secondaryEmployeeId: diffValue(
      diffNumber(client.secondaryEmployee?.id),
      diffText(client.secondaryEmployee?.name) ?? diffNumber(client.secondaryEmployee?.id),
    ),
    type: diffValue(type, type === null ? null : getVoucherTypeLabel(type)),
    duration: diffValue(duration, duration === null ? null : `${duration}일`),
    fullPrice: diffValue(fullPrice, priceDisplay(fullPrice)),
    grant: diffValue(grant, priceDisplay(grant)),
    actualPrice: diffValue(actualPrice, priceDisplay(actualPrice)),
    startDate: diffValue(diffDate(client.startDate)),
    endDate: diffValue(diffDate(client.endDate)),
  };
}

export function buildClientDiffSnapshotFromForm(
  form: ClientDiffFormValues,
  formatArea: AreaDisplayFormatter,
): ClientDiffSnapshot {
  const parsedDuration = Number.parseInt(form.duration, 10);
  const duration = Number.isFinite(parsedDuration) ? diffNumber(parsedDuration) : null;
  const fullPrice = diffPrice(form.fullPrice);
  const grant = diffPrice(form.grant);
  const actualPrice = diffPrice(form.actualPrice);
  const areaId = diffText(form.areaId);
  const type = diffText(form.type);
  return {
    phone: diffPhone(form.phone),
    birthday: diffValue(diffBirthday(form.birthday)),
    address: diffValue(diffText(form.address)),
    areaId: diffValue(areaId, areaDisplay(areaId, formatArea)),
    primaryEmployeeId: diffValue(
      diffNumber(form.primaryEmployeeId),
      diffText(form.primaryEmployeeName) ?? diffNumber(form.primaryEmployeeId),
    ),
    secondaryEmployeeId: diffValue(
      diffNumber(form.secondaryEmployeeId),
      diffText(form.secondaryEmployeeName) ?? diffNumber(form.secondaryEmployeeId),
    ),
    type: diffValue(type, type === null ? null : getVoucherTypeLabel(type)),
    duration: diffValue(duration, duration === null ? null : `${duration}일`),
    fullPrice: diffValue(fullPrice, priceDisplay(fullPrice)),
    grant: diffValue(grant, priceDisplay(grant)),
    actualPrice: diffValue(actualPrice, priceDisplay(actualPrice)),
    startDate: diffValue(diffDate(form.startDate)),
    endDate: diffValue(diffDate(form.endDate)),
  };
}

export function diffClientSnapshots(stored: ClientDiffSnapshot, form: ClientDiffSnapshot): ClientDiffRow[] {
  return CLIENT_DIFF_KEYS.filter((key) => stored[key].value !== form[key].value).map((key) => ({
    key,
    label: CLIENT_DIFF_LABELS[key],
    oldDisplay: stored[key].display ?? CLIENT_DIFF_EMPTY_DISPLAY,
    newDisplay: form[key].display ?? CLIENT_DIFF_EMPTY_DISPLAY,
  }));
}

export function serializeClientDiffSnapshot(snapshot: ClientDiffSnapshot): string {
  return JSON.stringify(CLIENT_DIFF_KEYS.map((key) => snapshot[key].value));
}

// 라벨 줄에 "등록된 정보와 달라요."를 보여줄 항목이에요. 저장값과 현재값이 모두 있고 서로 다를 때만이에요.
// 저장값이 비어 있으면(채워 넣는 것) 힌트가 없고, 현재값이 비어 있으면 저장값을 placeholder로 보여줘요.
export function getRegisteredDiffKeys(
  stored: ClientDiffSnapshot,
  form: ClientDiffSnapshot,
): ReadonlySet<ClientDiffKey> {
  return new Set(
    diffClientSnapshots(stored, form)
      .map((row) => row.key)
      .filter((key) => stored[key].value !== null && form[key].value !== null),
  );
}
