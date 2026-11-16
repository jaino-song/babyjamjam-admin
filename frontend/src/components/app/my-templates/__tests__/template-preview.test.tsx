import { render, screen } from "@testing-library/react";

import { TemplatePreview } from "../template-preview";

describe("TemplatePreview", () => {
    it("renders the shared auto fill message card with resolved variables", () => {
        const { container } = render(
            <TemplatePreview
                content={"Hello {{name}}\nTotal {{price}}"}
                variables={[
                    { key: "name", label: "Name", type: "text", required: true },
                    { key: "price", label: "Price", type: "number", required: true },
                ]}
            />
        );

        expect(container.querySelector('[data-component="desktop_messages_sections_generated-msg-panel"]')).toBeInTheDocument();
        expect(screen.getByRole("textbox")).toHaveValue("Hello [Name]\nTotal [Price]");
        expect(screen.getByText("{{name}}")).toBeInTheDocument();
        expect(screen.getByText("[Price]")).toBeInTheDocument();
        expect(container.querySelector('[data-component="desktop_messages_sections_generated-msg-detail-content"]')).not.toHaveAttribute("style");
    });

    it("uses the outlined white surface only when the editor opts in", () => {
        const { container } = render(<TemplatePreview content="본문" variables={[]} isTemplatePreview />);
        expect(container.querySelector('[data-component="desktop_messages_sections_generated-msg-detail-content"]')).toHaveStyle({
            background: "#fff",
            border: "1px solid #818b98",
            boxShadow: "none",
            borderRadius: "16px",
        });
    });
});
