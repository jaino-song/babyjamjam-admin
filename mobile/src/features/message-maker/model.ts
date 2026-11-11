import type { SystemTemplate } from '@/features/system-templates/types';
import type { MessageTemplate } from '@/lib/template/types';
import { extractVariables, renderTemplate } from '@/lib/template-utils';
import voucher from '@/components/app/messages/templates/json/voucher.json';

export interface MakerVariable {
  key: string;
  label: string;
  required?: boolean;
}
export interface MakerOption {
  value: string;
  name: string;
  content: string;
  variables: MakerVariable[];
  group: string;
  groupLabel?: string;
}
export const CUSTOM_OPTION = 'custom';
export const MAX_MAKER_BODY = 2000;
export const PRICE_VARIABLE_KEYS = new Set(['type', 'duration', 'weeks', 'fullPrice', 'grant', 'actualPrice', 'area', 'bankName', 'accNum']);

export function mergeMakerVariables(content: string, required: readonly MakerVariable[] = [], custom: readonly MakerVariable[] = []): MakerVariable[] {
  const used = new Set(extractVariables(content));
  const metadata = new Map<string, MakerVariable>();
  [...required, ...custom].forEach(variable => metadata.set(variable.key, {
    key: variable.key, label: variable.label || variable.key, required: variable.required ?? false,
  }));
  used.forEach(key => {
    if (!metadata.has(key)) metadata.set(key, { key, label: key, required: false });
  });
  return [...metadata.values()].filter(variable => used.has(variable.key));
}

export function buildMakerOptions(system: readonly SystemTemplate[], user: readonly MessageTemplate[]): MakerOption[] {
  return [
    ...system.map(template => ({
      value: `system:${template.templateKey}`, name: template.name, content: template.content,
      variables: mergeMakerVariables(template.content, template.requiredVariables, template.customVariables),
      group: `system:${template.group ?? 'ungrouped'}`, groupLabel: template.groupLabel,
    })),
    ...user.map(template => ({
      value: `user:${template.id}`, name: template.name, content: template.content,
      variables: mergeMakerVariables(template.content, template.variables), group: 'user', groupLabel: '사용자 템플릿',
    })),
    { value: CUSTOM_OPTION, name: '직접 작성', content: '', variables: [], group: 'custom', groupLabel: '직접 작성' },
  ];
}

export function renderMakerBody(content: string, values: Record<string, string>): string {
  return renderTemplate(content, values);
}

export function voucherTypeLabel(value: string): string {
  for (const types of Object.values(voucher.voucherOptions)) {
    for (const [key, option] of Object.entries(types)) if (key === value) return option.label;
  }
  return value;
}

export function formatMakerCurrency(value: string | null | undefined): string {
  if (!value?.trim()) return '';
  const trimmed = value.trim();
  const numeric = Number.parseInt(trimmed.replace(/[,원\s]/g, ''), 10);
  return Number.isNaN(numeric) ? trimmed : numeric.toLocaleString('ko-KR');
}
