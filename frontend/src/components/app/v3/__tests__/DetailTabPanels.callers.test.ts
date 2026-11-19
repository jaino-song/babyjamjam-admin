import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Source order matters: messages has an inset upcoming detail and a flush
// template detail. Keep the seven opt-ins separate from the three flush sites.
const callers = [
  { file: "components/app/clients/ClientDetailPanel.tsx", inset: [true] },
  { file: "components/app/employees/EmployeeDetailPanel.tsx", inset: [true] },
  { file: "app/(protected)/consultations/page.tsx", inset: [true] },
  { file: "app/(protected)/contracts/page.tsx", inset: [true] },
  { file: "app/(protected)/messages/page.tsx", inset: [true, false] },
  { file: "components/app/messages/TriggerRulesManager.tsx", inset: [true] },
  { file: "components/app/contracts/ContractAutomationsManager.tsx", inset: [true] },
  { file: "components/app/employees/EmployeeScheduleManager.tsx", inset: [false] },
  { file: "components/app/system-admin/SystemTemplatesManager.tsx", inset: [false] },
];

describe("DetailTabPanels caller inset contract", () => {
  it.each(callers)("pins inset opt-ins and flush panels in $file", ({ file, inset }) => {
    const source = readFileSync(join(__dirname, "../../../../", file), "utf8");
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const insetProps: string[][] = [];

    // Parse JSX rather than matching text in comments or stopping at a nested
    // expression's '>'. Only inspect each DetailTabPanels opening tag.
    function visit(node: ts.Node) {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(sourceFile) === "DetailTabPanels"
      ) {
        insetProps.push(
          node.attributes.properties
            .filter(ts.isJsxAttribute)
            .filter((attribute) => attribute.name.getText(sourceFile) === "insetPanels")
            .map((attribute) => attribute.getText(sourceFile)),
        );
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    // Exact arrays also fail if a caller disappears, duplicates, passes false,
    // or adds an opt-in to a flush surface. Current opt-ins use JSX shorthand.
    expect(insetProps).toEqual(inset.map((enabled) => enabled ? ["insetPanels"] : []));
  });
});
