/**
 * Auto-formats raw user input into the YYYY-MM-DD display shape. Strips
 * non-digits, caps at 8 digits, and inserts hyphens after positions 4 and 6.
 * Partial input (digits.length < 8) returns a partial display string —
 * callers typically keep external ISO state empty until full 10-char form.
 */
export declare function formatIsoDateInput(value: string): string;
