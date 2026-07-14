import { render, screen } from "@testing-library/react";

import { ProviderInfo } from "./provider-info";

describe("ProviderInfo", () => {
    it("should 기본 기관명을 표시 when providerName이 없을 때", () => {
        render(<ProviderInfo />);

        expect(screen.getByText("인천 아이미래로")).toBeInTheDocument();
    });

    it("should 전달받은 기관명을 표시 when providerName이 있을 때", () => {
        render(<ProviderInfo providerName="서울 아이미래로" />);

        expect(screen.getByText("서울 아이미래로")).toBeInTheDocument();
    });
});
