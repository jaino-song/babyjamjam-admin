'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { MessageSectionNav } from '@/components/app/mobile-redesign/MessageSectionNav';
import { ListCard } from '@/components/app/mobile-redesign/primitives';
import { FieldLabelRow, fieldMessageId } from '@/components/app/ui/FieldLabelRow';
import { Input } from '@/components/app/v3/Input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSystemTemplates } from '@/features/system-templates/hooks/useSystemTemplates';
import { buildMakerOptions, makerAreaLabel, MAX_MAKER_BODY, PRICE_VARIABLE_KEYS, type MakerOption } from '@/features/message-maker/model';
import { useMessageMaker } from '@/features/message-maker/useMessageMaker';
import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { useMessageTemplates } from '@/hooks/use-message-templates';
import { useMessagesPermissionGuard } from '@/app/(shell)/messages/MessagesPermissionGuard';
import styles from '@/app/(shell)/messages/new/page.module.css';
import '@/components/app/mobile-redesign/redesign.css';
import { MsgField } from './templates/MsgField';
import voucher from './templates/json/voucher.json';
import { MessageTemplateSelect } from './MessageTemplateSelect';
import groupStyles from './MessageTemplateSelect.module.css';

interface MakerFieldProps {
  base: string;
  id: string;
  label: string;
  required?: boolean;
  children: ReactNode;
}

function MakerField({ base, id, label, required = false, children }: MakerFieldProps): React.JSX.Element {
  return <div data-component={base} data-slot="form-section" data-source-component="MakerField" className={styles.formSection}>
    <FieldLabelRow data-component={base} htmlFor={id} label={label} required={required} message={null} />
    {children}
  </div>;
}

function MessageMakerEditor({ base, options }: { base: string; options: MakerOption[] }): React.JSX.Element {
  const maker = useMessageMaker(options);
  const bodyId = 'maker-body';
  const priceBase = `${base}_price-info`;
  const bodyBase = `${base}_message-body`;
  const plainVariables = maker.selected.variables.filter(variable => !maker.isPrice || !PRICE_VARIABLE_KEYS.has(variable.key));
  const priceFields = [
    { key: 'type', label: '바우처 유형', value: maker.values.type ?? '', change: (value: string) => maker.changeVariable('type', value), disabled: false,
      options: Object.entries(voucher.voucherOptions).flatMap(([, types]) => Object.entries(types).map(([value, option]) => ({ value, label: option.label }))) },
    { key: 'duration', label: '서비스 기간', value: maker.price?.duration ?? '', change: (value: string) => maker.changeVariable('duration', value), disabled: !maker.values.type || !maker.pricesReady || !maker.priceRows.length,
      options: maker.priceRows.map(row => ({ value: row.duration, label: `${row.duration}일` })) },
    { key: 'year', label: '바우처 연도', value: String(maker.year), change: maker.changeYear, disabled: false,
      options: [maker.currentYear - 1, maker.currentYear, maker.currentYear + 1].map(year => ({ value: String(year), label: `${year}년` })) },
    { key: 'area', label: '지역', value: maker.account?.area ?? '', change: maker.changeArea, disabled: !maker.accountsReady || !maker.accountRows.length,
      options: maker.accountRows.map(row => ({ value: row.area, label: makerAreaLabel(row.area) })) },
  ];
  return <div data-component={base} data-slot="unified-form-card-content" data-source-component="MessageMakerEditor" className={styles.unifiedFormCardContent}>
    <MakerField base={`${base}_template`} id="maker-template" label="템플릿 선택" required>
      <MessageTemplateSelect data-component={`${base}_template_select`} id="maker-template" value={maker.selected.value} options={options} onValueChange={maker.changeTemplate} />
    </MakerField>
    {plainVariables.map((variable, index) => {
      const id = `maker-variable-${index}`;
      const fieldBase = `${base}_variable-${index}`;
      return <MakerField key={`${maker.selected.value}:${variable.key}`} base={fieldBase} id={id} label={variable.label} required={variable.required}>
        <Input data-component={`${fieldBase}_input`} id={id} type="text" autoComplete="off" aria-describedby={fieldMessageId(id)} aria-required={variable.required} placeholder={variable.label}
          value={maker.values[variable.key] ?? ''} onChange={event => maker.changeVariable(variable.key, event.target.value)} />
      </MakerField>;
    })}
    {maker.isPrice && <div data-component={priceBase} data-slot="price-info-controls" className={styles.priceInfoControls}>
      {priceFields.map(field => {
        const fieldBase = `${priceBase}_${field.key}`;
        const id = `maker-price-${field.key}`;
        const metadata = maker.selected.variables.find(variable => variable.key === field.key);
        return <MakerField key={field.key} base={fieldBase} id={id} label={metadata?.label ?? field.label} required={metadata?.required}>
          <Select value={field.value} onValueChange={field.change} disabled={field.disabled}>
            <SelectTrigger data-component={`${fieldBase}_select`} data-slot="variable-select-trigger" id={id} aria-describedby={fieldMessageId(id)} className={styles.variableSelectTrigger}>
              <SelectValue placeholder={metadata?.label ?? field.label} />
            </SelectTrigger>
            <SelectContent data-component={`${fieldBase}_select_content`} data-slot="template-select-content" className={styles.templateSelectContent} avoidCollisions>
              {field.key === 'type' ? Object.entries(voucher.voucherOptions).map(([group, types], index) => <SelectGroup key={group} data-component={`${fieldBase}_select_content_group-${index}`}>
                <SelectLabel data-component={`${fieldBase}_select_content_group-${index}_label`} data-slot="template-group-label" className={groupStyles.templateGroupLabel}>{group}</SelectLabel>
                {Object.entries(types).map(([value, option], optionIndex) => <SelectItem key={value} value={value} data-component={`${fieldBase}_select_content_group-${index}_option-${optionIndex}`}>{option.label}</SelectItem>)}
              </SelectGroup>) : field.options.map((option, index) => <SelectItem key={option.value} value={option.value} data-component={`${fieldBase}_select_content_option-${index}`}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </MakerField>;
      })}
      {maker.values.type && (!maker.pricesReady || !maker.priceRows.length) && <div role="status" data-component={`${priceBase}_prices-status`}>
        {maker.prices.isError ? '비용 정보를 불러오지 못했습니다.' : maker.prices.isLoading || maker.prices.isFetching ? '비용 정보를 불러오는 중입니다.' : '선택한 유형과 연도의 비용 정보가 없습니다.'}
        {!maker.prices.isLoading && !maker.prices.isFetching && <Button type="button" variant="ghost" size="sm" data-component={`${priceBase}_prices-status_retry`} onClick={() => void maker.prices.refetch()}>비용 정보 다시 시도</Button>}
      </div>}
      {(!maker.accountsReady || !maker.accountRows.length) && <div role="status" data-component={`${priceBase}_accounts-status`}>
        {maker.accounts.isError ? '계좌 정보를 불러오지 못했습니다.' : maker.accounts.isLoading || maker.accounts.isFetching ? '계좌 정보를 불러오는 중입니다.' : '등록된 계좌 정보가 없습니다.'}
        {!maker.accounts.isLoading && !maker.accounts.isFetching && <Button type="button" variant="ghost" size="sm" data-component={`${priceBase}_accounts-status_retry`} onClick={() => void maker.accounts.refetch()}>계좌 정보 다시 시도</Button>}
      </div>}
      {(maker.price || maker.account) && <div data-component={`${priceBase}_summary`} data-slot="price-info-summary" className={styles.priceInfoSummary}>
        {[
          ['총 서비스 금액', maker.resolvedValues.fullPrice], ['정부지원금', maker.resolvedValues.grant], ['본인부담금', maker.resolvedValues.actualPrice],
          ['계좌', [maker.account?.bankName, maker.account?.accNum].filter(Boolean).join(' ')],
        ].map(([label, value], index) => <div key={label} data-component={`${priceBase}_summary_row-${index}`} data-slot="price-info-summary-row" className={styles.priceInfoSummaryRow}><span>{label}</span><strong>{value || '-'}</strong></div>)}
      </div>}
    </div>}
    <div data-component={bodyBase} data-slot="form-section" className={styles.formSection}>
      <div data-component={`${bodyBase}_header`} data-slot="form-section-header" className={styles.formSectionHeader}>
        <div data-slot="form-section-label" className={styles.formSectionLabel}>
          <FieldLabelRow data-component={`${bodyBase}_header`} htmlFor={bodyId} label="메시지 본문" message={maker.copyFeedback} />
        </div>
        <Button type="button" variant="ghost" size="sm" data-component={`${bodyBase}_header_copy`} onClick={() => void maker.copyBody(bodyId)}>복사</Button>
      </div>
      <MsgField data-component={`${bodyBase}_field`} inputId={bodyId} ariaLabel="메시지 본문" ariaDescribedBy={fieldMessageId(bodyId)} value={maker.body} maxLength={MAX_MAKER_BODY} onChange={maker.changeBody}
        className={styles.messageField} textareaClassName={styles.messageFieldTextarea} />
    </div>
  </div>;
}

function MessageMakerCatalog({ base }: { base: string }): React.JSX.Element {
  const system = useSystemTemplates();
  const user = useMessageTemplates();
  const refetchUser = user.refetch;
  const [userReady, setUserReady] = useState(false);
  // The existing user-template hook has a shared query key. Revalidate on every
  // branch-session mount before exposing it; never show the previous branch cache.
  useEffect(() => {
    let active = true;
    void refetchUser().then(result => { if (active) setUserReady(!result.isError); });
    return () => { active = false; };
  }, [refetchUser]);
  const isError = system.isError || user.isError;
  if (isError) return <div role="alert" data-component={`${base}_catalog-error`}>
    템플릿을 불러오지 못했습니다.
    <Button type="button" variant="ghost" data-component={`${base}_catalog-error_retry`} onClick={async () => {
      setUserReady(false);
      const [, result] = await Promise.all([system.refetch(), refetchUser()]);
      setUserReady(!result.isError);
    }}>템플릿 다시 시도</Button>
  </div>;
  if (system.isLoading || system.isPlaceholderData || system.data === undefined || user.isLoading || !userReady || user.data === undefined) {
    return <div role="status" data-component={`${base}_catalog-loading`}>템플릿을 불러오는 중입니다.</div>;
  }
  return <MessageMakerEditor key={JSON.stringify([system.data, user.data])} base={base} options={buildMakerOptions(system.data, user.data)} />;
}

export function MessageMaker({ 'data-component': base }: { 'data-component': string }): React.JSX.Element {
  const auth = useGetAuthUser();
  const permission = useMessagesPermissionGuard();
  const formBase = `${base}_screen_content`;
  const cardBase = `${formBase}_scroll_list-card`;
  const ready = auth.data?.branchId && !permission.isLoading && !permission.needsSenderApproval;
  return <section data-component={base} data-slot="messages-page" data-source-component="MessageMaker" className={styles.pageRoot}>
    <div data-component={`${base}_screen`} data-slot="phone-screen" className={styles.phoneScreen}>
      <div data-component={formBase} data-slot="messages-content" className={`shell-content gap-[calc(8px*var(--glint-ui-scale,1))] ${styles.navPage}`}>
        <MessageSectionNav data-component={`${formBase}_section-nav`} activeId="complete" />
        <div data-component={`${formBase}_scroll`} data-slot="messages-scroll" className={styles.msgScroll}>
          <ListCard data-component={cardBase} title="메세지 제작" filters={[]} loadMore={false}>
            {ready ? <MessageMakerCatalog key={auth.data?.branchId} base={`${cardBase}_body_content`} /> : <div role="status" data-component={`${cardBase}_body_session-status`}>
              {auth.isError || !auth.data?.branchId && !auth.isLoading ? '지점 정보를 확인해 주세요.' : permission.needsSenderApproval ? '발신번호 승인 후 사용할 수 있습니다.' : '지점 정보를 확인하는 중입니다.'}
              {auth.isError && <Button type="button" variant="ghost" data-component={`${cardBase}_body_session-status_retry`} onClick={() => void auth.refetch()}>지점 정보 다시 시도</Button>}
            </div>}
          </ListCard>
        </div>
      </div>
    </div>
  </section>;
}
