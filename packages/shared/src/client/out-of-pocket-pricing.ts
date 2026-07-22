export interface OutOfPocketPriceInfo {
  id?: number;
  duration: number;
  fullPrice: string;
}

const SERVICE_DAYS_PER_WEEK = 5;

export function formatOutOfPocketDurationLabel(duration: number): string {
  if (duration > 0 && duration % SERVICE_DAYS_PER_WEEK === 0) {
    return `${duration / SERVICE_DAYS_PER_WEEK}주 (${duration}일)`;
  }

  return `${duration}일`;
}

export function findOutOfPocketPriceInfo(
  priceInfos: readonly OutOfPocketPriceInfo[] | null | undefined,
  duration: number | null | undefined,
): OutOfPocketPriceInfo | null {
  if (!priceInfos || duration == null) return null;
  return priceInfos.find((priceInfo) => priceInfo.duration === duration) ?? null;
}
