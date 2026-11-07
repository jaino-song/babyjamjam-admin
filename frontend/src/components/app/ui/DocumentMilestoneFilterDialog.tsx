"use client";

import { useId, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { FormDialogShell } from './FormDialogShell';
import { FormSection, FormGrid, FormField, FormTextInput, FormHelperText, FormChip } from './form-section';
import {
  CONTRACT_MILESTONES, RECORD_MILESTONES, cloneDocumentScope, defaultDocumentScope,
  documentScopeSummary, kstToday, validateDocumentScope, withPeriod,
  type DocumentMilestoneScope, type DocumentKind, type PeriodPreset,
} from '@/lib/eformsign-backup-view';

export interface DocumentMilestoneFilterDialogProps {
  dataComponent: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: DocumentMilestoneScope;
  onApply: (scope: DocumentMilestoneScope) => void;
}

export function DocumentMilestoneScopeSummary({ dataComponent, scope }: { dataComponent: string; scope: DocumentMilestoneScope }) {
  const summary = documentScopeSummary(scope);
  return <p data-component={dataComponent} data-slot="document-milestone-scope-summary" data-source-component="DocumentMilestoneScopeSummary" title={summary} className="min-w-0 truncate text-[calc(11px*var(--glint-ui-scale,1))] text-v3-text-muted">{summary}</p>;
}

export function DocumentMilestoneFilterDialog(props: DocumentMilestoneFilterDialogProps) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    {props.open ? <DocumentMilestoneFilterDraft {...props} /> : null}
  </Dialog>;
}

function DocumentMilestoneFilterDraft({ dataComponent, scope, onApply, onOpenChange }: DocumentMilestoneFilterDialogProps) {
  // A fresh draft mounts on every open. Closing through any Radix path discards it.
  const [draft, setDraft] = useState(() => cloneDocumentScope(scope));
  const formId = useId();
  const errors = validateDocumentScope(draft);
  const formBase = `${dataComponent}_content_form`;
  const periodBase = `${formBase}_period_body`;
  const kindBase = `${formBase}_kind_body`;
  const apply = () => {
    if (Object.keys(errors).length) return;
    onApply(cloneDocumentScope(draft));
    onOpenChange(false);
  };
  return <FormDialogShell data-component={dataComponent} title="문서 필터" description="백업 대상 문서 범위" footer={<>
    <Button data-component={`${dataComponent}_actions_reset`} type="button" variant="ghost" size="sm" onClick={() => setDraft(defaultDocumentScope())}>초기화</Button>
    <Button data-component={`${dataComponent}_actions_cancel`} type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>취소</Button>
    <Button data-component={`${dataComponent}_actions_apply`} type="submit" form={formId} size="sm" disabled={Object.keys(errors).length > 0}>적용</Button>
  </>}>
    <form id={formId} data-component={formBase} data-slot="document-milestone-filter-form" data-source-component="DocumentMilestoneFilterDialog" className="flex min-w-0 flex-col gap-[calc(16px*var(--glint-ui-scale,1))]" noValidate onSubmit={event => { event.preventDefault(); apply(); }}>
      <FormSection data-component={`${formBase}_period`} title="작성일">
        <div className="mb-[calc(12px*var(--glint-ui-scale,1))] flex flex-wrap gap-[calc(6px*var(--glint-ui-scale,1))]">
          {([{ id: 'all', label: '전체' }, { id: '7', label: '최근 7일' }, { id: '30', label: '최근 30일' }, { id: 'custom', label: '직접 지정' }] as const).map(preset => <FormChip key={preset.id} data-component={`${periodBase}_preset-${preset.id}`} selected={draft.period === preset.id} aria-pressed={draft.period === preset.id} onClick={() => setDraft(withPeriod(draft, preset.id as PeriodPreset, kstToday()))}>{preset.label}</FormChip>)}
        </div>
        <FormGrid data-component={`${periodBase}_dates`} className="grid-cols-1 sm:grid-cols-2">
          {(['start', 'end'] as const).map(key => {
            const base = `${periodBase}_dates_${key}`;
            const id = `${formId}-${key}`;
            return <FormField key={key} data-component={base} htmlFor={id} label={key === 'start' ? '시작일' : '종료일'}>
              <FormTextInput data-component={`${base}_input`} id={id} type="date" value={draft[key]} error={Boolean(errors.period)} aria-invalid={Boolean(errors.period)} aria-describedby={errors.period ? `${formId}-period-error` : undefined} onChange={event => setDraft({ ...draft, period: 'custom', [key]: event.target.value })} />
            </FormField>;
          })}
        </FormGrid>
        {errors.period ? <FormHelperText data-component={`${periodBase}_error`} id={`${formId}-period-error`} tone="error" role="alert">{errors.period}</FormHelperText> : null}
      </FormSection>
      <FormSection data-component={`${formBase}_kind`} title="문서 종류">
        <RadioGroup data-component={`${kindBase}_options`} aria-label="문서 종류" value={draft.kind} onValueChange={kind => setDraft({ ...draft, kind: kind as DocumentKind })} className="flex flex-wrap gap-[calc(16px*var(--glint-ui-scale,1))]">
          {([{ id: 'all', label: '전체' }, { id: 'contract', label: '계약서' }, { id: 'record', label: '제공기록지' }] as const).map(kind => <label key={kind.id} data-component={`${kindBase}_options_${kind.id}`} className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))] text-[calc(12.8px*var(--glint-ui-scale,1))]">
            <RadioGroupItem data-component={`${kindBase}_options_${kind.id}_input`} value={kind.id} />{kind.label}
          </label>)}
        </RadioGroup>
      </FormSection>
      {([{ kind: 'contract', title: '계약서 단계', key: 'contractStages', options: CONTRACT_MILESTONES }, { kind: 'record', title: '제공기록지 단계', key: 'recordStages', options: RECORD_MILESTONES }] as const).filter(group => draft.kind === 'all' || draft.kind === group.kind).map(group => {
        const base = `${formBase}_${group.kind}-stages`;
        const selected = draft[group.key];
        const all = group.options.every(option => selected.some(id => id === option.id));
        const mixed = selected.length > 0 && !all;
        const error = errors[group.key];
        const change = (ids: readonly string[]) => setDraft(cloneDocumentScope({ ...draft, [group.key]: [...ids] }));
        return <FormSection key={group.kind} data-component={base} title={group.title}>
          <fieldset data-component={`${base}_body_choices`} aria-describedby={error ? `${formId}-${group.kind}-error` : undefined} className="min-w-0">
            <legend className="sr-only">{group.title}</legend>
            <label data-component={`${base}_body_choices_all`} className="mb-[calc(12px*var(--glint-ui-scale,1))] flex items-center gap-[calc(8px*var(--glint-ui-scale,1))] text-[calc(12.8px*var(--glint-ui-scale,1))]">
              <Checkbox data-component={`${base}_body_choices_all_input`} aria-label={`${group.title} 전체`} checked={all ? true : mixed ? 'indeterminate' : false} onCheckedChange={checked => change(checked === true ? group.options.map(s => s.id) : [])} />전체
            </label>
            <FormGrid data-component={`${base}_body_choices_stages`} className="grid-cols-1 sm:grid-cols-2">
              {group.options.map(option => <label key={option.id} data-component={`${base}_body_choices_stages_${option.id}`} className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))] text-[calc(12.8px*var(--glint-ui-scale,1))]">
                <Checkbox data-component={`${base}_body_choices_stages_${option.id}_input`} aria-label={`${group.title} ${option.label}`} checked={selected.some(id => id === option.id)} onCheckedChange={checked => change(checked === true ? [...selected, option.id] : selected.filter(id => id !== option.id))} />{option.label}
              </label>)}
            </FormGrid>
            {error ? <FormHelperText data-component={`${base}_body_choices_error`} id={`${formId}-${group.kind}-error`} tone="error" role="alert">{error}</FormHelperText> : null}
          </fieldset>
        </FormSection>;
      })}
    </form>
  </FormDialogShell>;
}
