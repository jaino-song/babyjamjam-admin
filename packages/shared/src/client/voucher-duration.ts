export interface VoucherPriceInfoLike {
  duration: string | number | null | undefined;
  fullPrice?: string | number | null | undefined;
  grant?: string | number | null | undefined;
  actualPrice?: string | number | null | undefined;
}

type VoucherAmountKey = "fullPrice" | "grant" | "actualPrice";

function normalizeNumericString(value: string | number | null | undefined): string | null {
  if (value == null) return null;

  const raw = String(value).trim();
  if (!raw || raw === "NaN" || raw === "Infinity" || raw === "-Infinity") return null;

  const digits = raw.replace(/[^\d]/g, "");
  return digits ? digits : null;
}

function normalizeDuration(value: string | number | null | undefined): string | null {
  const normalized = normalizeNumericString(value);
  if (normalized == null) return null;

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? String(numeric) : null;
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
    const target = normalizeNumericString(amounts[key]);
    if (target === null) continue;

    matchedAny = true;
    candidates = candidates.filter(
      (candidate) => normalizeNumericString(candidate[key]) === target,
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
