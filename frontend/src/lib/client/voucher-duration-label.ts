export function formatVoucherDurationLabel(
  duration: number,
  availableDurations: readonly number[],
): string {
  const durations = [...new Set(availableDurations.filter(
    (value) => Number.isFinite(value) && Number.isInteger(value) && value > 0,
  ))].sort((a, b) => a - b);
  const rank = durations.indexOf(duration);

  if (durations.length !== 3 || rank === -1) return `${duration}일`;

  const labels = ["단축형", "표준형", "연장형"];
  return `${duration}일 (${labels[rank]})`;
}
