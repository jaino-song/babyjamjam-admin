/**
 * Assertions for the "one slot per field" contract: every field message sits in
 * the label row above its control and nothing renders below a control.
 */

const MESSAGE_SELECTOR = '[data-slot="field-message"], [data-slot="field-error-message"]';
const CONTROL_SELECTOR = 'input, select, textarea, [role="combobox"], [role="switch"]';

export function getFieldMessages(root: ParentNode): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
}

/** The control a message belongs to: the first control after it inside its field container. */
export function getControlOfMessage(message: HTMLElement): HTMLElement | null {
    let container = message.parentElement;
    while (container && container.querySelectorAll(CONTROL_SELECTOR).length === 0) {
        container = container.parentElement;
    }
    if (!container) return null;
    return (
        Array.from(container.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).find(
            (control) => Boolean(message.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING),
        ) ?? null
    );
}

/** Fails when any field message renders after (below) the control of its field. */
export function expectNoFieldMessageBelowControl(root: ParentNode): void {
    const messages = getFieldMessages(root);
    const offenders = messages
        .filter((message) => getControlOfMessage(message) === null)
        .map((message) => message.textContent);
    expect(offenders).toEqual([]);
}
