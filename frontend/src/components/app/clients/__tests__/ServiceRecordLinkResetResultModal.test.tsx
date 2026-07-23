import { fireEvent, render, screen } from "@testing-library/react";

import { ServiceRecordLinkResetResultModal } from "../ServiceRecordLinkResetResultModal";

describe("ServiceRecordLinkResetResultModal", () => {
    it("shows the reset link and lets the admin copy it", () => {
        const onCopy = jest.fn();
        const serviceRecordUrl = "https://mobile.test/service-record/efl_reset";

        render(
            <ServiceRecordLinkResetResultModal
                open
                serviceRecordUrl={serviceRecordUrl}
                onClose={jest.fn()}
                onCopy={onCopy}
            />,
        );

        expect(screen.getByRole("dialog", { name: "제공기록지 링크가 재설정되었습니다" })).toBeInTheDocument();
        expect(screen.getByRole("textbox", { name: "제공기록지 링크" })).toHaveValue(serviceRecordUrl);

        fireEvent.click(screen.getByRole("button", { name: "링크 복사" }));
        expect(onCopy).toHaveBeenCalledWith(serviceRecordUrl);
    });
});
