import dayjs from "dayjs";

import type { Employee } from "@/hooks/useEmployees";
import type { AreaTemplate } from "@/hooks/useVoucherData";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import type { Client } from "@/lib/client/types";
import type { ContractDataDto } from "@/services/api";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const SERVICE_CONTRACT_RE = /서비스\s*계약서/;

export interface BuildClientContractDataParams {
  client: Client;
  employees: readonly Employee[];
  areaTemplates: readonly AreaTemplate[];
  today?: string | Date;
}

export interface BuiltClientContractData {
  contractData: ContractDataDto;
  areaId: string;
}

function normalizeIsoDate(value: string | null | undefined): string {
  const normalized = value?.slice(0, 10) ?? "";
  return DATE_ONLY_RE.test(normalized) ? normalized : "";
}

function requireText(value: string | null | undefined, label: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new Error(`${label} 정보가 없습니다.`);
  }
  return trimmed;
}

function requireDate(value: string | null | undefined, label: string): string {
  const normalized = normalizeIsoDate(value);
  if (!normalized) {
    throw new Error(`${label} 정보가 없습니다.`);
  }
  return normalized;
}

function templateDistrictLabels(template: AreaTemplate): string[] {
  const templateName = template.templateName?.trim() ?? "";
  const compactName = templateName
    .replace(SERVICE_CONTRACT_RE, "")
    .replace(/계약서|신청서/g, "")
    .trim();
  const firstWord = templateName.split(/\s+/)[0]?.trim() ?? "";

  return Array.from(new Set([compactName, firstWord])).filter((label) => label.length >= 2);
}

export function resolveContractAreaTemplateId(
  client: Client,
  areaTemplates: readonly AreaTemplate[],
): string {
  const templates = areaTemplates.filter((template) => template.areaId.trim());
  if (templates.length === 0) {
    throw new Error("계약서 템플릿 정보를 불러오지 못했습니다.");
  }

  const serviceTemplates = templates.filter((template) => SERVICE_CONTRACT_RE.test(template.templateName ?? ""));
  const candidates = serviceTemplates.length > 0 ? serviceTemplates : templates;
  const address = client.address?.trim() ?? "";

  const matched = candidates
    .map((template) => ({
      template,
      labelLength: Math.max(
        0,
        ...templateDistrictLabels(template)
          .filter((label) => address.includes(label))
          .map((label) => label.length),
      ),
    }))
    .filter((item) => item.labelLength > 0)
    .sort((a, b) => b.labelLength - a.labelLength)[0];
  if (matched) return matched.template.areaId;

  const uniqueAreaIds = new Set(candidates.map((template) => template.areaId));
  if (uniqueAreaIds.size === 1) {
    return candidates[0].areaId;
  }

  throw new Error("계약서 유형을 주소에서 판단할 수 없습니다. 고객 주소를 확인해 주세요.");
}

export function buildClientContractData({
  client,
  employees,
  areaTemplates,
  today,
}: BuildClientContractDataParams): BuiltClientContractData {
  const customerName = requireText(client.name, "고객 이름");
  const customerContact = requireText(client.phone, "고객 연락처");
  const primaryEmployeeId = client.primaryEmployee?.id;
  const primaryEmployeeName = requireText(client.primaryEmployee?.name, "제공인력");
  const primaryEmployee = employees.find((employee) => employee.id === primaryEmployeeId);
  const primaryEmployeePhone = requireText(primaryEmployee?.phone, "제공인력 연락처");
  const voucherType = requireText(client.type, "바우처 유형");
  const voucherDuration = client.duration != null ? String(client.duration) : "";
  if (!voucherDuration) {
    throw new Error("서비스 기간 정보가 없습니다.");
  }

  const startDate = requireDate(client.startDate, "서비스 시작일");
  const endDate = normalizeIsoDate(client.endDate) || calcEndDateBusinessDays(startDate, Number(voucherDuration));
  if (!endDate) {
    throw new Error("서비스 종료일 정보가 없습니다.");
  }

  const start = dayjs(startDate);
  const end = dayjs(endDate);
  const payment = dayjs(startDate);
  const receipt = dayjs(today);
  const receiptDate = receipt.isValid() ? receipt : dayjs();
  const areaId = resolveContractAreaTemplateId(client, areaTemplates);

  return {
    areaId,
    contractData: {
      customerName,
      customerContact,
      customerDOB: client.birthday ?? "",
      customerAddress: client.address ?? "",
      caretaker1Name: primaryEmployeeName,
      caretaker1Contact: primaryEmployeePhone,
      type: voucherType,
      days: voucherDuration,
      area: areaId,
      contractDuration: `${start.format("YYYY-MM-DD")} ~ ${end.format("YYYY-MM-DD")}`,
      startYear: start.format("YY"),
      startMonth: start.format("MM"),
      startDay: start.format("DD"),
      startDate,
      endYear: end.format("YY"),
      endMonth: end.format("MM"),
      endDay: end.format("DD"),
      endDate,
      paymentYear: payment.format("YY"),
      paymentMonth: payment.format("MM"),
      paymentDay: payment.format("DD"),
      receiptYear: receiptDate.format("YY"),
      receiptMonth: receiptDate.format("MM"),
      receiptDay: receiptDate.format("DD"),
      fullPrice: requireText(client.fullPrice, "총 서비스 금액"),
      grant: requireText(client.grant, "정부지원금"),
      actualPrice: requireText(client.actualPrice, "본인부담금"),
    },
  };
}
