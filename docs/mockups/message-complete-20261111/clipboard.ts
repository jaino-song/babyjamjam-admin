/** HTTP fallback copies from the real, editable message textarea. */
export async function copyMessage(text: string, textareaId: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* Insecure HTTP / denied permission: try the user-initiated selection path. */ }
  const textarea = document.getElementById(textareaId);
  if (!(textarea instanceof HTMLTextAreaElement)) return false;
  const focused = document.activeElement;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const direction = textarea.selectionDirection;
  const scrollTop = textarea.scrollTop;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.setSelectionRange(start, end, direction);
    textarea.scrollTop = scrollTop;
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
