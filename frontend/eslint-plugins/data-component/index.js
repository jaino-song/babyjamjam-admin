"use strict";

const STRUCTURAL_ELEMENTS = new Set([
  "div",
  "section",
  "nav",
  "main",
  "aside",
  "article",
  "header",
  "footer",
]);

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const requireDataComponent = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require data-component attribute on structural DOM elements",
      category: "Best Practices",
    },
    fixable: null,
    schema: [],
    messages: {
      missingDataComponent:
        "Structural element <{{element}}> is missing a 'data-component' attribute.",
      invalidFormat:
        "data-component value '{{value}}' must be kebab-case (e.g., 'my-component-name').",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const elementName = node.name && node.name.name;

        // Skip if not a string name (e.g., member expressions like Component.Sub)
        if (typeof elementName !== "string") return;

        // Skip non-structural elements
        if (!STRUCTURAL_ELEMENTS.has(elementName)) return;

        // Find data-component attribute
        const dataComponentAttr = node.attributes.find(
          (attr) =>
            attr.type === "JSXAttribute" &&
            attr.name &&
            attr.name.name === "data-component"
        );

        if (!dataComponentAttr) {
          context.report({
            node,
            messageId: "missingDataComponent",
            data: { element: elementName },
          });
          return;
        }

        // Validate kebab-case format
        const value = dataComponentAttr.value;
        if (
          value &&
          value.type === "Literal" &&
          typeof value.value === "string"
        ) {
          if (!KEBAB_CASE_REGEX.test(value.value)) {
            context.report({
              node: dataComponentAttr,
              messageId: "invalidFormat",
              data: { value: value.value },
            });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: {
    name: "eslint-plugin-data-component",
    version: "1.0.0",
  },
  rules: {
    "require-data-component": requireDataComponent,
  },
};

module.exports = plugin;
