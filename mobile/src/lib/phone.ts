export function normalizeKoreanPhoneDigits(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");

  if (digits.startsWith("8210")) return `010${digits.slice(4)}`;
  if (digits.startsWith("820")) return `0${digits.slice(3)}`;
  if (digits.startsWith("82") && digits.length >= 11) return `0${digits.slice(2)}`;

  return digits;
}

export function formatKoreanPhoneNumber(value: string | null | undefined): string {
  const digits = normalizeKoreanPhoneDigits(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6, 10)}`;

  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
}
