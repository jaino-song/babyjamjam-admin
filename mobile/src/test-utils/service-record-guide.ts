import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/** Accessible name of the 제공기록지 작성 가이드 sheet (`mobile_service-record_wizard_guide_sheet`). */
export const SERVICE_RECORD_GUIDE_NAME = "제공기록지 작성 가이드";

export const queryServiceRecordGuide = () => screen.queryByRole("dialog", { name: SERVICE_RECORD_GUIDE_NAME });

/**
 * The mobile screen opens the how-to guide over a first-time (`header == null`) service-info step, and the
 * modal makes the form behind it inaccessible. A user skips it with 건너뛰기; this does the same and waits
 * for the dialog to go away. Pass a `user` from `userEvent.setup()` to click as that user, or omit it under
 * fake timers (the click is then a plain `fireEvent`). It throws when the guide is not open, so a regression
 * of the auto-open fails here instead of passing silently.
 */
export async function dismissServiceRecordGuide(user?: UserEvent): Promise<void> {
    const dialog = await screen.findByRole("dialog", { name: SERVICE_RECORD_GUIDE_NAME });
    const skip = within(dialog).getByRole("button", { name: "건너뛰기" });
    if (user) await user.click(skip);
    else fireEvent.click(skip);
    await waitFor(() => expect(queryServiceRecordGuide()).toBeNull());
}
