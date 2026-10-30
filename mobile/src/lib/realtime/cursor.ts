// Realtime resume cursor (wire contract): an opaque token the backend stamps on
// every stream message and clients only echo back as `?since=`. Clients never
// parse it, only check it is shaped like one before remembering or forwarding
// it, so a malformed id can never reach a URL or the backend.
const CURSOR_PATTERN = /^[0-9A-Za-z:._-]+$/;
const CURSOR_MAX_LENGTH = 64;

export function isValidRealtimeCursor(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= CURSOR_MAX_LENGTH &&
    CURSOR_PATTERN.test(value)
  );
}
