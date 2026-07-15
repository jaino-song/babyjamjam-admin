export interface VoucherPriceInfoLike {
  duration: string | number | null | undefined;
  fullPrice?: string | number | null | undefined;
  grant?: string | number | null | undefined;
  actualPrice?: string | number | null | undefined;
}

function normalizeNumericString(value: string | number | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const digits = String(value).replace(/[^\d]/g, "");
  return digits ? digits : null;
}

function normalizeDuration(value: string | number | null | undefined): string | null {
  const digits = normalizeNumericString(value);
  return digits ? String(Number(digits)) : null;
}

export function inferVoucherDurationFromAmounts(
  priceInfos: VoucherPriceInfoLike[] | null | undefined,
  amounts: {
    fullPrice?: string | number | null;
    grant?: string | number | null;
    actualPrice?: string | number | null;
  }
): string | null {
  if (!priceInfos || priceInfos.length === 0) {
    return null;
  }

  const targets = [
    { key: "fullPrice" as const, value: normalizeNumericString(amounts.fullPrice) },
    { key: "grant" as const, value: normalizeNumericString(amounts.grant) },
    { key: "actualPrice" as const, value: normalizeNumericString(amounts.actualPrice) },
  ];

  let candidates = priceInfos.filter((priceInfo) => normalizeDuration(priceInfo.duration));
  let matchedAny = false;

  for (const target of targets) {
    if (!target.value) {
      continue;
    }

    const matched = candidates.filter(
      (candidate) => normalizeNumericString(candidate[target.key]) === target.value
    );

    if (matched.length > 0) {
      candidates = matched;
      matchedAny = true;
    }
  }

  if (!matchedAny) {
    return null;
  }

  const durations = [...new Set(candidates.map((candidate) => normalizeDuration(candidate.duration)).filter(Boolean))];
  return durations.length === 1 ? durations[0] : null;
}
