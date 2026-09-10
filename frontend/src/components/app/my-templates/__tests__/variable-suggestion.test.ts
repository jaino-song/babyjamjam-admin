import { Editor, Node } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { PluginKey } from "@tiptap/pm/state";
import type { MessageTemplateVariable } from "@babyjamjam/shared/types/message";
import { createVariableSuggestion } from "../variable-suggestion";

it("rejects a stale suggestion command after the real editor becomes read-only", () => {
  const editor = new Editor({
    extensions: [Document, Paragraph, Text, Node.create({
      name: "variable", group: "inline", inline: true, atom: true,
      addAttributes: () => ({ key: { default: "" } }),
      renderHTML: () => ["span"],
    })],
    content: "<p>/</p>",
  });
  try {
    const variable: MessageTemplateVariable = { key: "name", label: "이름", type: "text", required: false };
    const command = createVariableSuggestion({
      char: "/", pluginKey: new PluginKey("staleSuggestionTest"),
      variablesRef: { current: [variable] },
    }).command!;
    const input = { editor, range: { from: 1, to: 2 }, props: variable };
    editor.setEditable(false);
    const before = editor.getJSON();
    command(input);
    expect(editor.getJSON()).toEqual(before);
    editor.setEditable(true);
    command(input);
    expect(editor.getJSON().content?.[0].content?.[0]).toMatchObject({
      type: "variable", attrs: { key: "name" },
    });
  } finally {
    editor.destroy();
  }
});
