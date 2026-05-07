/**
 * Auto-formats raw user input into the YYYY-MM-DD display shape. Strips
 * non-digits, caps at 8 digits, and inserts hyphens after positions 4 and 6.
 * Partial input (digits.length < 8) returns a partial display string —
 * callers typically keep external ISO state empty until full 10-char form.
 */
export function formatIsoDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}
