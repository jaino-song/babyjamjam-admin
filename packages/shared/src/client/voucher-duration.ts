export interface VoucherPriceInfoLike {
  duration: string | number | null | undefined;
  fullPrice?: string | number | null | undefined;
  grant?: string | number | null | undefined;
  actualPrice?: string | number | null | undefined;
}

type VoucherAmountKey = "fullPrice" | "grant" | "actualPrice";

function normalizeVoucherAmount(value: string | number | null | undefined): string | null {
  if (value == null) return null;

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  const raw = value.trim();
  if (!raw) return null;

  const isPlainDigits = /^\d+(?:\s*원)?$/.test(raw);
  const isCommaGrouped = /^\d{1,3}(?:,\d{3})+(?:\s*원)?$/.test(raw);
  if (!isPlainDigits && !isCommaGrouped) return null;

  return raw.replace(/\s*원$/, "").replace(/,/g, "");
}

function isMissingAmount(value: string | number | null | undefined): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function normalizeDuration(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }

  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;

  const numeric = Number(normalized);
  return Number.isSafeInteger(numeric) ? String(numeric) : null;
}

/**
 * Infer a single voucher duration from the supplied price clues.
 *
 * Missing clues are ignored. A supplied clue is strict: it must match at
 * least one candidate that survived the previous clues. This makes a typo or
 * stale amount a safe `null` instead of silently selecting an unrelated
 * duration.
 */
export function inferVoucherDurationFromAmounts(
  priceInfos: readonly VoucherPriceInfoLike[] | null | undefined,
  amounts: Partial<Record<VoucherAmountKey, string | number | null | undefined>>,
): string | null {
  if (!priceInfos || priceInfos.length === 0) return null;

  let candidates = priceInfos.filter((priceInfo) => normalizeDuration(priceInfo.duration) !== null);
  let matchedAny = false;

  for (const key of ["fullPrice", "grant", "actualPrice"] as const) {
    if (isMissingAmount(amounts[key])) continue;

    const target = normalizeVoucherAmount(amounts[key]);
    if (target === null) return null;

    matchedAny = true;
    candidates = candidates.filter(
      (candidate) => normalizeVoucherAmount(candidate[key]) === target,
    );

    if (candidates.length === 0) return null;
  }

  if (!matchedAny) return null;

  const durations = [
    ...new Set(
      candidates
        .map((candidate) => normalizeDuration(candidate.duration))
        .filter((duration): duration is string => duration !== null),
    ),
  ];

  return durations.length === 1 ? durations[0] : null;
}

export const inferVoucherDuration = inferVoucherDurationFromAmounts;
