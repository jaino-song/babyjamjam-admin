'use client';

import { Fragment } from 'react';

import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { MakerOption } from '@/features/message-maker/model';
import formStyles from '@/app/(shell)/messages/new/page.module.css';
import styles from './MessageTemplateSelect.module.css';

interface MessageTemplateSelectProps {
  'data-component': string;
  id: string;
  value: string;
  options: MakerOption[];
  onValueChange: (value: string) => void;
}

/** Contiguous server groups keep the authoritative catalog's exact order. */
export function MessageTemplateSelect({ 'data-component': base, id, value, options, onValueChange }: MessageTemplateSelectProps): React.JSX.Element {
  const sections: { group: string; label?: string; options: MakerOption[] }[] = [];
  options.forEach(option => {
    const previous = sections.at(-1);
    if (previous?.group === option.group && previous.label === option.groupLabel) previous.options.push(option);
    else sections.push({ group: option.group, label: option.groupLabel, options: [option] });
  });
  return <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger id={id} data-component={base} data-slot="template-select-trigger" data-source-component="MessageTemplateSelect" className={formStyles.templateSelectTrigger}>
      <SelectValue placeholder="템플릿 선택" />
    </SelectTrigger>
    <SelectContent data-component={`${base}_content`} data-slot="template-select-content" className={formStyles.templateSelectContent} avoidCollisions>
      {sections.map((section, index) => <Fragment key={`${section.group}-${index}`}>
        {index > 0 && <SelectSeparator data-component={`${base}_content_separator-${index}`} data-slot="template-group-separator" className={styles.templateGroupSeparator} />}
        <SelectGroup data-component={`${base}_content_group-${index}`}>
          {section.label && <SelectLabel data-component={`${base}_content_group-${index}_label`} data-slot="template-group-label" className={styles.templateGroupLabel}>{section.label}</SelectLabel>}
          {section.options.map((option, optionIndex) => <SelectItem key={option.value} value={option.value} data-component={`${base}_content_group-${index}_option-${optionIndex}`}>{option.name}</SelectItem>)}
        </SelectGroup>
      </Fragment>)}
    </SelectContent>
  </Select>;
}
