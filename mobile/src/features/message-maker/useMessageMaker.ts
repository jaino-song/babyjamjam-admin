'use client';

import { useEffect, useRef, useState } from 'react';

import { useBankAccountInfos, useVoucherPriceInfos } from '@/hooks/useVoucherData';
import type { MakerOption } from './model';
import { CUSTOM_OPTION, formatMakerCurrency, makerAreaLabel, MAX_MAKER_BODY, renderMakerBody, voucherTypeLabel } from './model';
import { copyMakerBody } from './clipboard';

export function useMessageMaker(options: MakerOption[]) {
  const currentYear = new Date().getFullYear();
  const [selectedValue, setSelectedValue] = useState(() => options.find(option => option.value === 'system:PRICE_INFO')?.value ?? options.find(option => option.value.startsWith('system:'))?.value ?? CUSTOM_OPTION);
  const [values, setValues] = useState<Record<string, string>>({});
  const [area, setArea] = useState('');
  const [year, setYear] = useState(currentYear);
  const [override, setOverride] = useState<{ value: string; generation: string } | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ text: string; tone: 'ok' | 'err'; generation: string } | null>(null);
  const copyAttempt = useRef(0);
  const selected = options.find(option => option.value === selectedValue) ?? options.find(option => option.value === CUSTOM_OPTION) ?? options[0];
  const isPrice = selected.value === 'system:PRICE_INFO';
  const prices = useVoucherPriceInfos(isPrice ? values.type ?? '' : '', year);
  const accounts = useBankAccountInfos();
  const pricesReady = !prices.isLoading && !prices.isFetching && !prices.isError && prices.data !== undefined;
  const accountsReady = !accounts.isLoading && !accounts.isFetching && !accounts.isError && accounts.data !== undefined;
  const priceRows = pricesReady ? prices.data ?? [] : [];
  const accountRows = accountsReady ? accounts.data ?? [] : [];
  const price = priceRows.find(row => row.duration === values.duration);
  const account = accountRows.find(row => row.area === area);
  const resolvedValues = isPrice ? {
    ...values,
    type: voucherTypeLabel(values.type ?? ''),
    duration: price?.duration ?? '',
    weeks: price ? String(Math.floor(Number(price.duration) / 5)) : '',
    fullPrice: formatMakerCurrency(price?.fullPrice),
    grant: formatMakerCurrency(price?.grant),
    actualPrice: formatMakerCurrency(price?.actualPrice),
    area: makerAreaLabel(account?.area ?? ''), bankName: account?.bankName ?? '', accNum: account?.accNum ?? '',
  } : values;
  const generated = renderMakerBody(selected.content, resolvedValues);
  // Generation includes availability: an old manual body cannot mask failed derived data.
  const generation = JSON.stringify([selected.value, selected.content, values, area, year, resolvedValues, isPrice && pricesReady, isPrice && accountsReady]);
  // Clear overrides at the first observed dependency transition, including background errors.
  const [previousGeneration, setPreviousGeneration] = useState(generation);
  if (previousGeneration !== generation) {
    setPreviousGeneration(generation);
    setOverride(null);
    setCopyFeedback(null);
    if (isPrice && values.duration && !price) setValues(previous => ({ ...previous, duration: '' }));
    if (isPrice && area && !account) setArea('');
  }
  const body = override?.generation === generation ? override.value : generated;
  useEffect(() => {
    copyAttempt.current += 1;
    return () => { copyAttempt.current += 1; };
  }, [generation, body]);

  function clearEditingFeedback(): void {
    copyAttempt.current += 1;
    setOverride(null);
    setCopyFeedback(null);
  }
  function changeTemplate(value: string): void {
    setSelectedValue(value); setValues({}); setArea(''); setYear(currentYear); clearEditingFeedback();
  }
  function changeVariable(key: string, value: string): void {
    setValues(previous => ({ ...previous, [key]: value, ...(key === 'type' ? { duration: '' } : {}) }));
    clearEditingFeedback();
  }
  function changeYear(value: string): void {
    setYear(Number(value)); setValues(previous => ({ ...previous, duration: '' })); clearEditingFeedback();
  }
  function changeArea(value: string): void { setArea(value); clearEditingFeedback(); }
  function changeBody(value: string): void {
    copyAttempt.current += 1;
    setOverride({ value: value.slice(0, MAX_MAKER_BODY), generation }); setCopyFeedback(null);
  }
  async function copyBody(textareaId: string): Promise<void> {
    const attempt = ++copyAttempt.current;
    const copied = await copyMakerBody(body, textareaId);
    if (copyAttempt.current !== attempt) return;
    setCopyFeedback({ generation, tone: copied ? 'ok' : 'err', text: copied ? '복사했습니다' : '본문을 선택해 직접 복사해 주세요' });
  }
  return {
    selected, values, resolvedValues, area, year, currentYear, isPrice, price, account, priceRows, accountRows,
    prices, accounts, pricesReady, accountsReady, body,
    copyFeedback: copyFeedback?.generation === generation ? copyFeedback : null,
    changeTemplate, changeVariable, changeYear, changeArea, changeBody, copyBody,
  };
}
