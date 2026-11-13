/** Copy only from the visible editable body; restore focus and selection on HTTP fallback. */
export async function copyMakerBody(text: string, textareaId: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* User-initiated HTTP fallback uses the actual textarea below. */ }
  const textarea = document.getElementById(textareaId);
  if (!(textarea instanceof HTMLTextAreaElement) || textarea.value !== text) return false;
  const focused = document.activeElement;
  const { selectionStart, selectionEnd, selectionDirection, scrollTop } = textarea;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
    textarea.scrollTop = scrollTop;
    if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
  }
}
