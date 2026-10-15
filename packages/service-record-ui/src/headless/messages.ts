import type { SlotMessage } from "../field-messages";

export const errorMessage = (text: string): SlotMessage => ({ tone: "error", text });
export const hintMessage = (text: string): SlotMessage => ({ tone: "hint", text });
