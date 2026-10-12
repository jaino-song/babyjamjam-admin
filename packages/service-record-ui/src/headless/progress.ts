import { DAY_PAGES } from "../form-definition";
import type { ServiceRecordScreen } from "../types";

/** Wizard progress bar percentage for a screen (and the day page index on the day screen). */
export function getWizardProgress(screen: ServiceRecordScreen, pageIdx: number): number {
    return screen === "done"
        ? 100
        : screen === "day"
            ? 20 + Math.round(((pageIdx + 1) / DAY_PAGES.length) * 70)
            : screen === "overview"
                ? 20
                : screen === "service"
                    ? 12
                    : 5;
}
