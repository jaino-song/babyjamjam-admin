import { render, screen } from "@testing-library/react";

import { SignaturePad } from "./SignaturePad";

// jsdom has no canvas context: a minimal stand-in so the pad's sizing code runs quietly.
beforeEach(() => {
    const context = {
        clearRect: jest.fn(), setTransform: jest.fn(), drawImage: jest.fn(),
        lineCap: "", lineJoin: "", lineWidth: 0, strokeStyle: "",
    } as unknown as CanvasRenderingContext2D;
    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
});
afterEach(() => jest.restoreAllMocks());

const props = { "data-component": "pad", value: null, signedAt: null, onChange: jest.fn(), locked: false };

describe("SignaturePad layout outside the package's .srec styles", () => {
    it("gives the canvas an explicit height and width", () => {
        render(<SignaturePad {...props} />);
        const canvas = screen.getByLabelText("산모 서명 입력");
        expect(canvas).toHaveClass("h-[150px]", "w-full", "border-dashed");
    });

    it("renders the hint as an overlay sibling of the canvas that fades once inked", () => {
        const { rerender } = render(<SignaturePad {...props} />);
        const canvas = screen.getByLabelText("산모 서명 입력");
        const hint = screen.getByText("여기에 손가락으로 서명해 주세요");
        expect(hint.parentElement).toBe(canvas.parentElement);
        expect(hint).toHaveClass("absolute", "inset-0", "pointer-events-none");
        expect(hint).not.toHaveClass("opacity-0");
        rerender(<SignaturePad {...props} value="data:image/png;base64,AAAA" />);
        expect(screen.getByText("여기에 손가락으로 서명해 주세요")).toHaveClass("opacity-0");
        expect(screen.getByLabelText("산모 서명 입력")).toHaveClass("border-solid", "border-v3-primary!");
    });

    it("locks the pad: no pointer events, dim background, no clear button, signed chip", () => {
        render(<SignaturePad {...props} locked signedAt="2026-09-21T01:02:00Z" value="data:image/png;base64,AAAA" />);
        expect(screen.getByLabelText("산모 서명 입력")).toHaveClass("pointer-events-none", "bg-v3-dim-white");
        expect(screen.queryByRole("button", { name: "서명 지우기" })).toBeNull();
        expect(screen.getByText(/서명 완료/)).toHaveClass("inline-block");
    });

    it("keeps the package class names the old wizard and its tests rely on", () => {
        render(<SignaturePad {...props} />);
        expect(screen.getByLabelText("산모 서명 입력")).toHaveClass("pad");
        expect(screen.getByRole("button", { name: "서명 지우기" })).toHaveClass("sign-clear");
    });
});
