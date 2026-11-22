/** @jest-environment node */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const ERROR_NAMES = ["error", "err", "e", "requestError", "reason", "cause"];
const LOG_LEVELS = new Set(["error", "warn", "log", "info", "debug"]);

function rawErrorLogLines(source: string, filename = "example.ts"): number[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const tracked = new Set(ERROR_NAMES);

  function trackBinding(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      tracked.add(name.text);
    } else {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) trackBinding(element.name);
      }
    }
  }

  function collectCatchBindings(node: ts.Node): void {
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      trackBinding(node.variableDeclaration.name);
    }
    ts.forEachChild(node, collectCatchBindings);
  }
  collectCatchBindings(file);

  function containsRawError(node: ts.Expression): boolean {
    if (ts.isIdentifier(node)) return tracked.has(node.text);
    if (
      ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node)
      || ts.isNonNullExpression(node) || ts.isSpreadElement(node)
    ) {
      return containsRawError(node.expression);
    }
    if (ts.isObjectLiteralExpression(node)) {
      return node.properties.some((property) => {
        if (ts.isShorthandPropertyAssignment(property)) return tracked.has(property.name.text);
        if (ts.isPropertyAssignment(property)) return containsRawError(property.initializer);
        if (ts.isSpreadAssignment(property)) return containsRawError(property.expression);
        return false;
      });
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.some(containsRawError);
    if (ts.isConditionalExpression(node)) {
      return containsRawError(node.whenTrue) || containsRawError(node.whenFalse);
    }
    if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "JSON"
      && node.expression.name.text === "stringify"
    ) {
      return node.arguments.some(containsRawError);
    }
    // Calls, member accesses and template literals are deliberate boundaries.
    return false;
  }

  const lines: number[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "console"
      && LOG_LEVELS.has(node.expression.name.text) && node.arguments.some(containsRawError)
    ) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return lines;
}

function productionFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["__tests__", "tests", "__integrity__"].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) ? [path] : [];
  });
}

describe("raw error log detection", () => {
  it.each([
    "error", "err", "e", "requestError", "reason", "cause",
    "{ error }", "{ failure: error }", "JSON.stringify(error)",
    "JSON.stringify({ failure: [error] })", "((error as Error)!)",
    "(error satisfies Error)", "(<Error>error)", "[error]", "[...error]",
    "{ ...error }", "ok ? error : null", "ok ? null : error",
  ])("flags %s", (argument) => {
    expect(rawErrorLogLines(`console.error('failure', ${argument});`)).toEqual([1]);
  });

  it.each(["error", "warn", "log", "info", "debug"])("checks console.%s", (level) => {
    expect(rawErrorLogLines(`console.${level}(error);`)).toEqual([1]);
  });

  it("tracks catch bindings regardless of their name and reports the console line", () => {
    expect(rawErrorLogLines("try {} catch (uploadFailure) {\nconsole.warn({ uploadFailure });\n}"))
      .toEqual([2]);
  });

  it.each([
    "summarizeErrorForLog(error)", "error.message", "error?.response?.status",
    "String(error)", "`${error}`", "{ error: summarizeErrorForLog(error) }",
    "JSON.stringify({ message: error.message })", "error ? 'failed' : 'ok'",
    "'error'", "status", "42",
  ])("accepts %s", (argument) => {
    expect(rawErrorLogLines(`console.error('failure', ${argument});`)).toEqual([]);
  });
});

it("does not log raw errors anywhere in production frontend source", () => {
  const violations = productionFiles(join(process.cwd(), "src")).flatMap((path) =>
    rawErrorLogLines(readFileSync(path, "utf8"), path).map((line) =>
      `${relative(process.cwd(), path)}:${line}`),
  );
  expect(violations).toEqual([]);
});
