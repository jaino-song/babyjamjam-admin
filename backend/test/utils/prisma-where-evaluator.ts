/**
 * A faithful in-memory evaluator of the subset of Prisma `where` filters the client lists use,
 * so a test fixture can answer `findMany({ where })` by evaluating the COMPLETE predicate
 * instead of returning a canned array. A mutation of the where clause (an extra impossible
 * condition, a flipped bound) therefore changes what the fixture returns.
 *
 * SQL semantics are kept where they matter: any comparison against a NULL column is false,
 * so `notIn`, `lt`, `gte`, `not: <value>` never match a NULL (exactly why the real queries
 * spell out `OR [{ col: null }, ...]`). Anything this evaluator does not know throws, so it
 * can never silently accept a predicate it did not actually evaluate.
 */
type Row = Record<string, unknown>;

const COMBINATORS = new Set(["AND", "OR", "NOT"]);
const OPERATORS = new Set(["equals", "not", "in", "notIn", "lt", "lte", "gt", "gte"]);

function comparable(value: unknown): number | string | boolean {
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
    throw new Error(`prisma-where-evaluator: cannot compare ${String(value)}`);
}

function isOperatorObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !(value instanceof Date) && !Array.isArray(value);
}

function matchesOperators(fieldValue: unknown, operators: Record<string, unknown>): boolean {
    return Object.entries(operators).every(([operator, operand]) => {
        if (!OPERATORS.has(operator)) {
            throw new Error(`prisma-where-evaluator: unsupported operator "${operator}"`);
        }
        if (operator === "not" && operand === null) return fieldValue !== null && fieldValue !== undefined;
        if (operator === "equals" && operand === null) return fieldValue === null || fieldValue === undefined;
        // SQL: a comparison with NULL is never true.
        if (fieldValue === null || fieldValue === undefined) return false;
        const actual = comparable(fieldValue);
        switch (operator) {
            case "equals": return actual === comparable(operand);
            case "not": return actual !== comparable(operand);
            case "in": return (operand as unknown[]).map(comparable).includes(actual);
            case "notIn": return !(operand as unknown[]).map(comparable).includes(actual);
            case "lt": return actual < comparable(operand);
            case "lte": return actual <= comparable(operand);
            case "gt": return actual > comparable(operand);
            case "gte": return actual >= comparable(operand);
            default: throw new Error(`prisma-where-evaluator: unsupported operator "${operator}"`);
        }
    });
}

function asList<T>(value: T | T[]): T[] {
    return Array.isArray(value) ? value : [value];
}

export function matchesWhere(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return Object.entries(where).every(([key, condition]) => {
        if (COMBINATORS.has(key)) {
            const clauses = asList(condition as Row | Row[]);
            if (key === "AND") return clauses.every((clause) => matchesWhere(row, clause));
            if (key === "OR") return clauses.some((clause) => matchesWhere(row, clause));
            return !clauses.some((clause) => matchesWhere(row, clause));
        }
        const fieldValue = row[key];
        if (condition === null) return fieldValue === null || fieldValue === undefined;
        if (isOperatorObject(condition)) return matchesOperators(fieldValue, condition);
        if (fieldValue === null || fieldValue === undefined) return false;
        return comparable(fieldValue) === comparable(condition);
    });
}

/** `findMany` stand-in answering from `rows` by evaluating the whole `where`. */
export function findManyFrom(rows: readonly Row[]) {
    return async (args?: { where?: Row }): Promise<Row[]> =>
        rows.filter((row) => matchesWhere(row, args?.where));
}
