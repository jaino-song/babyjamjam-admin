/** @jest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const ERROR_NAMES = ["error", "err", "e", "requestError", "reason", "cause"];
const LOG_LEVELS = new Set(["error", "warn", "log", "info", "debug"]);
const TEST_DIRECTORIES = new Set(["__tests__", "__integrity__", "tests"]);

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return TEST_DIRECTORIES.has(entry.name) ? [] : productionFiles(filename);
    }
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [filename] : [];
  }).sort();
}

function containsRawError(node: ts.Node, tracked: Set<string>): boolean {
  if (ts.isIdentifier(node)) return tracked.has(node.text);
  if (
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)
    || ts.isNonNullExpression(node)
  ) {
    return containsRawError(node.expression, tracked);
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.some((property) => {
      if (ts.isPropertyAssignment(property)) return containsRawError(property.initializer, tracked);
      if (ts.isShorthandPropertyAssignment(property)) return containsRawError(property.name, tracked);
      if (ts.isSpreadAssignment(property)) return containsRawError(property.expression, tracked);
      return false;
    });
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => containsRawError(element, tracked));
  }
  if (ts.isSpreadElement(node)) return containsRawError(node.expression, tracked);
  if (ts.isConditionalExpression(node)) {
    return containsRawError(node.whenTrue, tracked) || containsRawError(node.whenFalse, tracked);
  }
  if (
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "JSON"
    && node.expression.name.text === "stringify"
  ) {
    return node.arguments.some((argument) => containsRawError(argument, tracked));
  }
  // Member access and templates select diagnostics; other calls may sanitize.
  return false;
}

function rawErrorLogLines(source: string, filename = "fixture.tsx"): number[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const tracked = new Set(ERROR_NAMES);
  function trackBinding(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) tracked.add(name.text);
    else name.elements.forEach((element) => {
      if (ts.isBindingElement(element)) trackBinding(element.name);
    });
  }
  function collectCatchBindings(node: ts.Node): void {
    if (ts.isCatchClause(node) && node.variableDeclaration) trackBinding(node.variableDeclaration.name);
    ts.forEachChild(node, collectCatchBindings);
  }
  collectCatchBindings(file);

  const lines: number[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console"
      && LOG_LEVELS.has(node.expression.name.text)
      && node.arguments.some((argument) => containsRawError(argument, tracked))
    ) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return lines;
}

describe("raw error log detection", () => {
  it.each([
    "error", "err", "e", "requestError", "reason", "cause",
    "{ error }", "{ failure: error }", "{ ...error }", "[error]", "[...error]", "...error",
    "(error)", "error as unknown", "error satisfies unknown", "error!",
    "ok ? error : null", "ok ? null : error", "JSON.stringify(error)",
    "JSON.stringify({ details: [error as unknown] })",
  ])("flags a raw value in %s", (argument) => {
    expect(rawErrorLogLines(`console.error("failure", ${argument});`)).toEqual([1]);
  });

  it.each([
    "summarizeErrorForLog(error)", "error.message", "error.response?.status", "String(error)",
    "`${error}`", "{ name: error.name }", "[summarizeErrorForLog(error)]", "{ error: status }",
  ])("accepts a selected or summarized diagnostic in %s", (argument) => {
    expect(rawErrorLogLines(`console.error("failure", ${argument});`)).toEqual([]);
  });

  it.each(["error", "warn", "log", "info", "debug"])("checks console.%s and reports the line", (level) => {
    expect(rawErrorLogLines(`try {} catch (failure) {\n console.${level}(failure);\n}`)).toEqual([2]);
  });
});

it("never logs raw errors in production mobile source", () => {
  const root = path.resolve(__dirname, "..");
  const violations = productionFiles(root).flatMap((filename) => {
    return rawErrorLogLines(readFileSync(filename, "utf8"), filename).map((line) => (
      `${path.relative(path.resolve(root, ".."), filename)}:${line}`
    ));
  });
  expect(violations).toEqual([]);
});
