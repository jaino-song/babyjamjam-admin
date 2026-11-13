import { copyMakerBody } from './clipboard';

describe('copyMakerBody', () => {
  const writeText = jest.fn();
  const execCopy = jest.fn();
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCopy });
    writeText.mockReset(); execCopy.mockReset();
    document.body.innerHTML = '<button id="focus">copy</button><textarea id="body">실제 본문</textarea>';
  });
  it('waits for clipboard success before returning true', async () => {
    writeText.mockResolvedValue(undefined);
    await expect(copyMakerBody('실제 본문', 'body')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('실제 본문');
    expect(execCopy).not.toHaveBeenCalled();
  });
  it('uses the actual textarea on insecure HTTP and restores focus, selection and scroll', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
    const body = document.getElementById('body') as HTMLTextAreaElement;
    const focus = document.getElementById('focus')!;
    body.setSelectionRange(1, 3, 'backward'); body.scrollTop = 12; focus.focus();
    execCopy.mockImplementation(() => {
      expect(document.activeElement).toBe(body);
      expect(body.selectionEnd).toBe(body.value.length);
      return true;
    });
    await expect(copyMakerBody('실제 본문', 'body')).resolves.toBe(true);
    expect(execCopy).toHaveBeenCalledWith('copy');
    expect(document.activeElement).toBe(focus);
    expect([body.selectionStart, body.selectionEnd, body.selectionDirection, body.scrollTop]).toEqual([1, 3, 'backward', 12]);
  });
  it('returns false on denial and never reports successful copy for a stale or absent textarea', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    execCopy.mockReturnValue(false);
    await expect(copyMakerBody('실제 본문', 'body')).resolves.toBe(false);
    await expect(copyMakerBody('stale', 'body')).resolves.toBe(false);
    await expect(copyMakerBody('실제 본문', 'missing')).resolves.toBe(false);
    expect(execCopy).toHaveBeenCalledTimes(1);
  });
});
