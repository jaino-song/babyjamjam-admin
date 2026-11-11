import { useState, type ReactNode } from 'react';
import { CheckCheck, FileText, History, Send, Settings2, Workflow, type LucideIcon } from 'lucide-react';

import { ListCard, MobileSectionNav } from '@/components/app/mobile-redesign/primitives';
import { FieldLabelRow, fieldMessageId } from '@/components/app/ui/FieldLabelRow';
import { Input } from '@/components/app/v3/Input';
import { MsgField } from '@/components/app/messages/templates/MsgField';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectValue, SelectTrigger } from '@/components/ui/select';
import styles from '@/app/(shell)/messages/new/page.module.css';
import { MESSAGE_SECTION_DEFINITIONS } from '../../../packages/shared/src/message/presentation';

import { copyMessage } from './clipboard';
import { findVoucherType, getSamplePrices, renderSampleBody, SAMPLE_AREAS, SAMPLE_TEMPLATES, VARIABLE_LABELS, VOUCHER_GROUPS, YEARS } from './catalog';

const PAGE = 'mobile_messages_new_page';
const FORM = `${PAGE}_screen_form`;
const CARD = `${FORM}_scroll_list-card`;
const CONTENT = `${CARD}_body_form-card_content`;
const ICONS: Record<string, LucideIcon> = { send: Send, history: History, templates: FileText, triggers: Workflow, settings: Settings2 };
const NAV_ITEMS = [
  { id: 'complete', label: '메세지 제작', icon: CheckCheck },
  ...MESSAGE_SECTION_DEFINITIONS.map(section => ({
    id: section.id as string, label: section.label as string, icon: ICONS[section.id],
  })),
];
const PRICE_KEYS = new Set(['weeks', 'duration', 'type', 'fullPrice', 'grant', 'actualPrice', 'bankName', 'accNum']);

interface PreviewFieldProps {
  base: string;
  id: string;
  label: string;
  required?: boolean;
  children: ReactNode;
}
function PreviewField({ base, id, label, required = true, children }: PreviewFieldProps): React.JSX.Element {
  return <div data-component={base} data-slot="form-section" data-source-component="PreviewField" className={styles.formSection}>
    <FieldLabelRow data-component={base} htmlFor={id} label={label} required={required} message={null} />
    {children}
  </div>;
}

// The organism is preview-only. All visible controls and product styles are imports.
export function MessageCompletePreview(): React.JSX.Element {
  const [templateId, setTemplateId] = useState('PRICE_INFO');
  const [values, setValues] = useState<Record<string, string>>({});
  const [area, setArea] = useState('');
  const [year, setYear] = useState('2026');
  const [override, setOverride] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const template = SAMPLE_TEMPLATES.find(item => item.id === templateId) ?? SAMPLE_TEMPLATES[2];
  const variableKeys = [...new Set([...template.body.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]))];
  const isPrice = templateId === 'PRICE_INFO';
  const voucherType = findVoucherType(values.type ?? '');
  const duration = values.duration ?? '';
  const bank = SAMPLE_AREAS.find(item => item.area === area);
  const prices = getSamplePrices(duration, year);
  const renderedValues = isPrice ? {
    ...values, ...prices,
    type: voucherType?.label ?? '',
    weeks: duration ? String(voucherType?.durations[duration]?.weeks ?? '') : '',
    bankName: bank?.bankName ?? '', accNum: bank?.accNum ?? '',
  } : values;
  const body = override ?? renderSampleBody(template.body, renderedValues);
  function changeVariable(key: string, value: string): void {
    setValues(previous => ({ ...previous, [key]: value, ...(key === 'type' ? { duration: '' } : {}) }));
    setOverride(null);
    setCopyStatus(null);
  }
  function changeTemplate(id: string): void {
    setTemplateId(id); setValues({}); setArea(''); setYear('2026'); setOverride(null); setCopyStatus(null);
  }
  const genericKeys = variableKeys.filter(key => key !== 'name' && !(isPrice && PRICE_KEYS.has(key)));
  const priceBase = `${CONTENT}_variables_price-info`;
  const bodyBase = `${CONTENT}_message-body_row`;
  return <section data-component={PAGE} data-slot="messages-page" data-source-component="MessageCompletePreview"
    data-page="messages-new" className={`messages-page ${styles.pageRoot}`}>
    <div data-component={`${PAGE}_screen`} data-slot="phone-screen" className={styles.phoneScreen}>
      <div data-component={FORM} data-slot="messages-content" className={`shell-content gap-[calc(8px*var(--glint-ui-scale,1))] ${styles.navPage}`}>
        <div data-component={`${FORM}_section-nav`} className="shrink-0">
          <MobileSectionNav data-component={`${FORM}_section-nav_nav`} items={NAV_ITEMS}
            activeId="complete" onSelect={() => {}} ariaLabel="메시지 기능 (미리보기)" />
        </div>
        <div data-component={`${FORM}_scroll`} data-slot="messages-scroll" className={styles.msgScroll}>
          <ListCard data-component={CARD} title="메세지 제작" filters={[]} loadMore={false}>
            <div data-component={`${CARD}_body_form-card`} data-slot="recipient-card" className={styles.recipientCard}>
              <div data-component={CONTENT} data-slot="unified-form-card-content" className={styles.unifiedFormCardContent}>
                <div data-component={`${CONTENT}_template`} data-slot="form-card-section" className={styles.formCardSection}>
                  <PreviewField base={`${CONTENT}_template_row`} id="template-select" label="템플릿 선택">
                    <Select value={templateId} onValueChange={changeTemplate}>
                      <SelectTrigger id="template-select" data-component={`${CONTENT}_template_row_select`}
                        aria-describedby={fieldMessageId('template-select')} className={styles.templateSelectTrigger}>
                        <SelectValue placeholder="템플릿 선택" />
                      </SelectTrigger>
                      <SelectContent className={styles.templateSelectContent} avoidCollisions>
                        {SAMPLE_TEMPLATES.map(item => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </PreviewField>
                </div>
                {variableKeys.includes('name') && <div data-component={`${CONTENT}_recipient`} data-slot="form-card-section" className={styles.formCardSection}>
                  <PreviewField base={`${CONTENT}_recipient_name-row`} id="recipient-name" label="산모님 성함">
                    <Input id="recipient-name" type="text" autoComplete="off" placeholder="산모님 성함"
                      data-component={`${CONTENT}_recipient_name-row_input`} aria-describedby={fieldMessageId('recipient-name')}
                      value={values.name ?? ''} onChange={event => changeVariable('name', event.target.value)} />
                  </PreviewField>
                </div>}
                {(isPrice || genericKeys.length > 0) && <div data-component={`${CONTENT}_variables`} data-slot="form-card-section" className={styles.formCardSection}>
                  {genericKeys.map(key => <PreviewField key={key} base={`${CONTENT}_variables_${key}-row`} id={`variable-${key}`} label={VARIABLE_LABELS[key] ?? key}>
                    <Input id={`variable-${key}`} autoComplete="off" value={values[key] ?? ''}
                      data-component={`${CONTENT}_variables_${key}-row_input`} aria-describedby={fieldMessageId(`variable-${key}`)}
                      placeholder={VARIABLE_LABELS[key] ?? key} onChange={event => changeVariable(key, event.target.value)} />
                  </PreviewField>)}
                  {isPrice && <div data-component={priceBase} data-slot="price-info-controls" className={styles.priceInfoControls}>
                    <PreviewField base={`${priceBase}_type-row`} id="price-info-type" label="바우처 유형">
                      <Select value={values.type ?? ''} onValueChange={value => changeVariable('type', value)}>
                        <SelectTrigger id="price-info-type" data-component={`${priceBase}_type-row_select`}
                          aria-describedby={fieldMessageId('price-info-type')} className={styles.variableSelectTrigger}>
                          <SelectValue placeholder="바우처 유형" />
                        </SelectTrigger>
                        <SelectContent className={styles.templateSelectContent}>
                          {VOUCHER_GROUPS.map(([group, types], index) => <SelectGroup key={group}>
                            <div data-component={`${priceBase}_type-row_group-${index}_label`} data-slot="select-group-label" className={styles.selectGroupLabel}>{group}</div>
                            {Object.entries(types).map(([key, item]) => <SelectItem key={key} value={key}>{item.label}</SelectItem>)}
                          </SelectGroup>)}
                        </SelectContent>
                      </Select>
                    </PreviewField>
                    <PreviewField base={`${priceBase}_duration-row`} id="price-info-duration" label="서비스 기간">
                      <Select value={duration} onValueChange={value => changeVariable('duration', value)} disabled={!voucherType}>
                        <SelectTrigger id="price-info-duration" data-component={`${priceBase}_duration-row_select`}
                          aria-describedby={fieldMessageId('price-info-duration')} className={styles.variableSelectTrigger}>
                          <SelectValue placeholder="서비스 기간" />
                        </SelectTrigger>
                        <SelectContent className={styles.templateSelectContent}>
                          {Object.keys(voucherType?.durations ?? {}).map(days => <SelectItem key={days} value={days}>{days}일</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </PreviewField>
                    <PreviewField base={`${priceBase}_bank-account-row`} id="price-info-bank-account" label="지역">
                      <Select value={area} onValueChange={value => { setArea(value); setOverride(null); setCopyStatus(null); }}>
                        <SelectTrigger id="price-info-bank-account" data-component={`${priceBase}_bank-account-row_select`}
                          aria-describedby={fieldMessageId('price-info-bank-account')} className={styles.variableSelectTrigger}>
                          <SelectValue placeholder="지역" />
                        </SelectTrigger>
                        <SelectContent className={styles.templateSelectContent}>
                          {SAMPLE_AREAS.map(item => <SelectItem key={item.area} value={item.area}>{item.area}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </PreviewField>
                    <PreviewField base={`${priceBase}_year-row`} id="price-info-year" label="바우처 연도">
                      <Select value={year} onValueChange={value => { setYear(value); setOverride(null); setCopyStatus(null); }}>
                        <SelectTrigger id="price-info-year" data-component={`${priceBase}_year-row_select`}
                          aria-describedby={fieldMessageId('price-info-year')} className={styles.variableSelectTrigger}>
                          <SelectValue placeholder="바우처 연도" />
                        </SelectTrigger>
                        <SelectContent className={styles.templateSelectContent}>
                          {YEARS.map(value => <SelectItem key={value} value={value}>{value}년</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </PreviewField>
                    {duration && <div data-component={`${priceBase}_summary`} data-slot="price-info-summary" className={styles.priceInfoSummary}>
                      {[
                        ['바우처', voucherType?.label], ['총 서비스 금액', prices.fullPrice], ['정부지원금', prices.grant],
                        ['본인부담금', prices.actualPrice], ['계좌', bank ? `${bank.bankName} ${bank.accNum}` : '-'],
                      ].map(([label, value], index) => <div key={label} data-component={`${priceBase}_summary_row-${index}`} data-slot="price-info-summary-row" className={styles.priceInfoSummaryRow}>
                        <span>{label}</span><strong>{value}</strong>
                      </div>)}
                    </div>}
                  </div>}
                </div>}
                <div data-component={`${CONTENT}_message-body`} data-slot="form-card-section" className={styles.formCardSection}>
                  <div data-component={bodyBase} data-slot="form-section" className={styles.formSection}>
                    <div data-component={`${bodyBase}_header`} data-slot="form-section-header" className={styles.formSectionHeader}>
                      <div data-slot="form-section-label" className={styles.formSectionLabel}>
                        <FieldLabelRow data-component={bodyBase} htmlFor="body" label="메시지 본문" message={copyStatus} />
                      </div>
                      <Button type="button" variant="ghost" size="sm" data-component={`${bodyBase}_header_copy`}
                        className="list-action ml-auto h-auto justify-end" onClick={async () => {
                          const copied = await copyMessage(body, 'body');
                          setCopyStatus(copied ? { tone: 'ok', text: '복사했습니다' } : { tone: 'err', text: '본문을 선택해 직접 복사해 주세요' });
                        }}>복사</Button>
                    </div>
                    <MsgField data-component={`${bodyBase}_field`} inputId="body" ariaLabel="메시지 본문"
                      ariaDescribedBy={fieldMessageId('body')} value={body} maxLength={10_000}
                      onChange={value => { setOverride(value); setCopyStatus(null); }}
                      className={styles.messageField} textareaClassName={styles.messageFieldTextarea} />
                  </div>
                </div>
              </div>
            </div>
          </ListCard>
        </div>
      </div>
    </div>
  </section>;
}
