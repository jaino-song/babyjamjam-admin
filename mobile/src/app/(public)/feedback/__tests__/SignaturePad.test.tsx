import { fireEvent, render, screen } from "@testing-library/react";

import { SignaturePad } from "@/components/app/feedback/SignaturePad";

const DATA_URI = "data:image/png;base64,c2lnbmF0dXJl";

function mockCanvas(): void {
    const context = {
        beginPath: jest.fn(),
        clearRect: jest.fn(),
        drawImage: jest.fn(),
        lineTo: jest.fn(),
        moveTo: jest.fn(),
        setTransform: jest.fn(),
        stroke: jest.fn(),
        lineCap: "",
        lineJoin: "",
        lineWidth: 0,
        strokeStyle: "",
    } as unknown as CanvasRenderingContext2D;

    jest.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    jest.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue({
        bottom: 150,
        height: 150,
        left: 0,
        right: 320,
        top: 0,
        width: 320,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    });
    jest.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(DATA_URI);
    HTMLCanvasElement.prototype.setPointerCapture = jest.fn();
}

describe("SignaturePad", () => {
    beforeEach(() => {
        mockCanvas();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("does not change a locked signature and shows the signed chip", () => {
        const onChange = jest.fn();

        render(
            <SignaturePad
                value={DATA_URI}
                signedAt="2026-07-15T09:00:00.000Z"
                onChange={onChange}
                locked
            />,
        );

        const canvas = screen.getByLabelText("산모 서명 입력");
        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText(/서명 완료 ·/)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "서명 지우기" })).not.toBeInTheDocument();
    });

    it("calls onChange when an unsigned pad receives a signature", () => {
        const onChange = jest.fn();

        render(
            <SignaturePad
                value={null}
                signedAt={null}
                onChange={onChange}
                locked={false}
            />,
        );

        const canvas = screen.getByLabelText("산모 서명 입력");
        fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 });
        fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
        fireEvent.pointerUp(canvas, { pointerId: 1 });

        expect(onChange).toHaveBeenCalledWith(DATA_URI);
    });
});
