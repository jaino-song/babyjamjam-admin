import { render } from "@testing-library/react";

import { MessagePhonePreview } from "../MessagePhonePreview";

describe("MessagePhonePreview", () => {
  it.each(["templates-preview-panel", "preview-phone"])(
    "keeps %s responsive within the 320px width cap",
    (suffix) => {
      const { container } = render(
        <MessagePhonePreview
          content="Preview message"
          dataComponentPrefix="desktop_messages_templates"
        />,
      );

      const element = container.querySelector(
        `[data-component="desktop_messages_templates_${suffix}"]`,
      );

      expect(element).toHaveClass("w-full", "max-w-[320px]", "min-w-0");
      expect(element).not.toHaveClass("w-[320px]");
      expect(element).not.toHaveClass("shrink-0");
    },
  );
});
