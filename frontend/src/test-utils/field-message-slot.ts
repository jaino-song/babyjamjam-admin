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

const LABEL_SELECTOR = `label, ${MESSAGE_SELECTOR}`;
/** Text that is not a field message: actions, hidden copy and unit suffixes. */
const NON_MESSAGE_TEXT_SELECTOR =
    'button, [role="button"], [aria-hidden="true"], [hidden], .sr-only, script, style, [data-component$="_suffix"]';

function isVisibleControl(control: HTMLElement): boolean {
    if (control.closest('[aria-hidden="true"]')) return false;
    return !(control instanceof HTMLInputElement && ["hidden", "checkbox", "radio"].includes(control.type));
}

/** The nearest ancestor of a control that also holds a label or message slot: the field. */
function getFieldContainer(control: HTMLElement): HTMLElement | null {
    let container = control.parentElement;
    while (container && container.querySelector(LABEL_SELECTOR) === null) {
        container = container.parentElement;
    }
    return container;
}

/** Text nodes that follow `control` in DOM order inside `container`, minus actions and hidden copy. */
function getTextAfterControl(control: HTMLElement, container: HTMLElement): string[] {
    const texts: string[] = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent?.trim();
        if (!text) continue;
        if (!(control.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
        if (control.contains(node)) continue;
        const parent = node.parentElement;
        if (parent?.closest(NON_MESSAGE_TEXT_SELECTOR)) continue;
        texts.push(text);
    }
    return texts;
}

/**
 * Fails when anything is rendered below a field's control: a field message
 * placed after its control, or ANY other text after it in the field container
 * (helper text, notes, hints), whether or not it carries a message `data-slot`.
 * Text inside buttons, hidden copy and `*_suffix` unit labels is not a message.
 * A container that holds several controls is judged by its last control only.
 */
export function expectNoFieldMessageBelowControl(root: ParentNode): void {
    const offenders: string[] = getFieldMessages(root)
        .filter((message) => getControlOfMessage(message) === null)
        .map((message) => message.textContent ?? "");

    const controls = Array.from(root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)).filter(isVisibleControl);
    controls.forEach((control) => {
        const container = getFieldContainer(control);
        if (!container) return;
        const siblings = controls.filter((other) => container.contains(other));
        if (siblings[siblings.length - 1] !== control) return;
        offenders.push(...getTextAfterControl(control, container));
    });

    expect(offenders).toEqual([]);
}
