import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { Prisma } from "@prisma/client";
import ts from "typescript";

import { EntityChangeEventBus, type EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { entityChangeExtension, stripSqlNonCode, watchedKindsInSql } from "./entity-change.extension";
import { PrismaService } from "./prisma.service";

/**
 * The entity-change extension decides "did this raw write change anything" from the result:
 * `$executeRaw*` gives the affected count, `$queryRaw*` gives rows. A `$queryRaw` write WITHOUT
 * `RETURNING` therefore always looks like a no-op (`[]`) even when rows changed, and the realtime
 * hint is silently lost. The extension must not "emit when unsure" (background jobs run raw
 * writes every few seconds in system scope and would storm every screen), so the call sites carry
 * the burden: a raw write on a watched table is either `$executeRaw*` or has `RETURNING`.
 *
 * Part 1 drives the real chained extension to pin the `$executeRaw` behaviour the call sites rely
 * on. Part 2 scans production sources so a regression of the call-site rule fails here.
 */

// ---------------------------------------------------------------------------------------------
// Part 1: the extension as registered on a real Prisma client, innermost terminal stubbed
// ---------------------------------------------------------------------------------------------

function terminalStub(raw: (operation: string) => unknown) {
    return Prisma.defineExtension({
        name: "test-terminal-response",
        query: {
            async $queryRaw() {
                return raw("$queryRaw");
            },
            async $executeRaw() {
                return raw("$executeRaw");
            },
        },
    });
}

function setup(raw: (operation: string) => unknown) {
    const bus = new EntityChangeEventBus();
    const events: EntityChangedEvent[] = [];
    bus.events$.subscribe((e) => events.push(e));
    // Prisma runs the first-registered extension outermost, so the stub is registered last and
    // answers where the engine would, while every hook of the extension under test stays in path.
    const client = new PrismaService().$extends(entityChangeExtension(bus)).$extends(terminalStub(raw));
    return { client, events };
}

describe("raw writes on a watched table, through the real chained extension", () => {
    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask", "setImmediate"] });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    const requeue = (id: string) => Prisma.sql`
        UPDATE "eformsign_document_job"
        SET status = 'queued', updated_at = now()
        WHERE id = ${id}::uuid AND status = 'failed'
    `;

    it("$executeRaw UPDATE on eformsign_document_job with count 1 emits one `document` event", async () => {
        const { client, events } = setup(() => 1);

        await client.$executeRaw(requeue("11111111-1111-4111-8111-111111111111"));
        jest.advanceTimersByTime(300);

        expect(events).toEqual([{ branchId: null, entities: ["document"] }]);
    });

    it("$executeRaw UPDATE on eformsign_document_job with count 0 emits nothing", async () => {
        const { client, events } = setup(() => 0);

        await client.$executeRaw(requeue("11111111-1111-4111-8111-111111111111"));
        jest.advanceTimersByTime(1000);

        expect(events).toEqual([]);
    });

    it("documents why call sites need RETURNING: a $queryRaw write without it reads as a no-op", async () => {
        // Postgres returns no rows for an UPDATE without RETURNING even when a row changed.
        const withoutReturning = setup(() => []);
        await withoutReturning.client.$queryRaw(requeue("11111111-1111-4111-8111-111111111111"));
        jest.advanceTimersByTime(1000);
        expect(withoutReturning.events).toEqual([]);

        const withReturning = setup(() => [{ id: "11111111-1111-4111-8111-111111111111" }]);
        await withReturning.client.$queryRaw(Prisma.sql`
            UPDATE "eformsign_document_job" SET status = 'queued' WHERE id = ${"x"}::uuid RETURNING id
        `);
        jest.advanceTimersByTime(300);
        expect(withReturning.events).toEqual([{ branchId: null, entities: ["document"] }]);
    });
});

// ---------------------------------------------------------------------------------------------
// Part 2: source guard. A raw write on a watched table must be `$executeRaw*` or carry RETURNING.
// ---------------------------------------------------------------------------------------------

interface WatchedWrite {
    line: number;
    kinds: string[];
    /** The function the SQL is an argument of (or the tag it is a template of); null when it is only stored. */
    consumer: string | null;
    hasReturning: boolean;
}

/** `rawStateExecute` is the `$executeRaw` wrapper in service-record-edit.repository.ts. */
const EXECUTE_CONSUMERS: ReadonlySet<string> = new Set(["$executeRaw", "$executeRawUnsafe", "rawStateExecute"]);
const RAW_CONSUMERS: ReadonlySet<string> = new Set(["$queryRaw", "$queryRawUnsafe", ...EXECUTE_CONSUMERS]);
const SQL_TAGS: ReadonlySet<string> = new Set(["sql", "Prisma.sql"]);
const TRANSPARENT_WRAPPERS = [
    ts.isParenthesizedExpression,
    ts.isAsExpression,
    ts.isNonNullExpression,
    ts.isSatisfiesExpression,
    ts.isConditionalExpression,
    ts.isBinaryExpression,
] as const;

/** A write statement, as opposed to prose such as a log line "Failed to update client service status". */
const WRITE_STATEMENT =
    /\bUPDATE\s+(?:"?public"?\.)?"?\w+"?\s+(?:AS\s+\w+\s+)?SET\b|\bINSERT\s+INTO\b|\bDELETE\s+FROM\b/i;

/** Static text of a SQL literal; `${...}` holes become `?` (they never carry a verb or table). */
function staticSqlText(node: ts.Node): string | null {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isTemplateExpression(node)) {
        return node.head.text + node.templateSpans.map((span) => `?${span.literal.text}`).join("");
    }
    return null;
}

function sqlConsumer(literal: ts.Node): { consumer: string | null; viaSqlTag: boolean } {
    let current: ts.Node = literal;
    let viaSqlTag = false;
    for (;;) {
        const parent: ts.Node | undefined = current.parent;
        if (!parent) return { consumer: null, viaSqlTag };
        if (ts.isTaggedTemplateExpression(parent) && parent.template === current) {
            const tag = parent.tag.getText();
            if (SQL_TAGS.has(tag)) {
                viaSqlTag = true;
                current = parent;
                continue;
            }
            return { consumer: tag.split(".").pop() ?? tag, viaSqlTag };
        }
        if (ts.isCallExpression(parent) && parent.arguments.some((argument) => argument === current)) {
            const callee = parent.expression;
            const name = ts.isPropertyAccessExpression(callee)
                ? callee.name.text
                : ts.isIdentifier(callee)
                  ? callee.text
                  : callee.getText();
            return { consumer: name, viaSqlTag };
        }
        if (TRANSPARENT_WRAPPERS.some((is) => is(parent))) {
            current = parent;
            continue;
        }
        return { consumer: null, viaSqlTag };
    }
}

/** Every SQL literal in `source` that writes a watched table. */
function watchedWrites(source: string, fileName = "source.ts"): WatchedWrite[] {
    const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    const writes: WatchedWrite[] = [];
    const visit = (node: ts.Node): void => {
        const text = staticSqlText(node);
        if (text !== null) {
            const kinds = [...watchedKindsInSql(text)];
            if (kinds.length > 0) {
                const { consumer, viaSqlTag } = sqlConsumer(node);
                const isSql = viaSqlTag || (consumer !== null && RAW_CONSUMERS.has(consumer)) || WRITE_STATEMENT.test(text);
                if (isSql) {
                    writes.push({
                        line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
                        kinds,
                        consumer,
                        // Comments and string literals are blanked first: `-- No RETURNING` is not one.
                        hasReturning: /\bRETURNING\b/i.test(stripSqlNonCode(text)),
                    });
                }
            }
        }
        // A template's holes can hold further SQL fragments, so always keep descending.
        ts.forEachChild(node, visit);
    };
    visit(file);
    return writes;
}

/** Watched writes that neither go through `$executeRaw*` (affected count) nor return rows (RETURNING). */
function findRawWriteViolations(source: string, fileName = "source.ts") {
    return watchedWrites(source, fileName)
        .filter((write) => !(write.consumer !== null && EXECUTE_CONSUMERS.has(write.consumer)) && !write.hasReturning)
        .map(({ line, consumer, kinds }) => ({ line, consumer, kinds }));
}

const backendRoot = join(__dirname, "../..");
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", "dist", "test", "migrations", "coverage"]);

function productionSources(root: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) {
            if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
                files.push(...productionSources(path));
            }
        } else if (/\.ts$/.test(entry.name) && !/\.(?:spec|test|d)\.ts$/.test(entry.name)) {
            files.push(path);
        }
    }
    return files;
}

const WRITE_VERB = /\b(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\b/i;

describe("raw-write call-site guard (findRawWriteViolations)", () => {
    const table = '"eformsign_document_job"';
    const update = `UPDATE ${table} SET status = 'queued' WHERE id = $1`;
    const unsafe = "UPDATE eformsign_document_job SET status = $1 WHERE id = $2";

    it("flags a $queryRaw write without RETURNING (the retry-requeue form)", () => {
        const source = `await tx.$queryRaw(Prisma.sql\`\n    UPDATE ${table}\n    SET status = 'queued'\n    WHERE id = \${id}::uuid\n\`);`;
        expect(findRawWriteViolations(source)).toEqual([{ line: 1, consumer: "$queryRaw", kinds: ["document"] }]);
    });

    it("flags the same write behind a wrapper helper, a tagged $queryRaw and $queryRawUnsafe", () => {
        expect(findRawWriteViolations(`await rawStateQuery(tx, Prisma.sql\`${update}\`);`)).toHaveLength(1);
        expect(findRawWriteViolations(`await tx.$queryRaw\`${update}\`;`)).toHaveLength(1);
        expect(findRawWriteViolations(`await tx.$queryRawUnsafe("${unsafe}", status, id);`)).toHaveLength(1);
        expect(findRawWriteViolations("await tx.$queryRaw(Prisma.sql`INSERT INTO \"message_log\" (a) VALUES (1)`);"))
            .toEqual([{ line: 1, consumer: "$queryRaw", kinds: ["message"] }]);
    });

    it("accepts $executeRaw* forms and any statement carrying RETURNING", () => {
        expect(findRawWriteViolations(`await tx.$executeRaw(Prisma.sql\`${update}\`);`)).toEqual([]);
        expect(findRawWriteViolations(`await tx.$executeRaw\`${update}\`;`)).toEqual([]);
        expect(findRawWriteViolations(`await tx.$executeRawUnsafe("${unsafe}", status, id);`)).toEqual([]);
        expect(findRawWriteViolations(`await tx.$queryRaw(Prisma.sql\`${update} RETURNING id\`);`)).toEqual([]);
        expect(findRawWriteViolations(`await updateOne(Prisma.sql\`${update} RETURNING *\`);`)).toEqual([]);
    });

    it("does not count RETURNING that only appears in a comment or a string literal", () => {
        const lineComment = `await tx.$queryRaw(Prisma.sql\`\n    -- No RETURNING: nobody reads the rows\n    ${update}\`);`;
        const blockComment = `await tx.$queryRaw(Prisma.sql\`/* RETURNING id */ ${update}\`);`;
        const stringLiteral = `await tx.$queryRaw(Prisma.sql\`UPDATE ${table} SET note = 'RETURNING id' WHERE id = $1\`);`;
        for (const source of [lineComment, blockComment, stringLiteral]) {
            expect(findRawWriteViolations(source)).toEqual([expect.objectContaining({ consumer: "$queryRaw", kinds: ["document"] })]);
        }
        // A real trailing RETURNING next to such noise still satisfies the guard.
        expect(findRawWriteViolations(`await tx.$queryRaw(Prisma.sql\`-- note\n    ${update}\n    RETURNING id\`);`)).toEqual([]);
    });

    it("ignores reads, locking selects and tables the stream does not watch", () => {
        expect(findRawWriteViolations(`await tx.$queryRaw(Prisma.sql\`SELECT id FROM ${table} FOR UPDATE\`);`)).toEqual([]);
        expect(findRawWriteViolations('await tx.$queryRaw(Prisma.sql`UPDATE "auth_session" SET a = 1`);')).toEqual([]);
        expect(findRawWriteViolations('logger.warn("Failed to update client service status");')).toEqual([]);
    });
});

describe("production raw writes on watched tables", () => {
    const sources = productionSources(backendRoot)
        .map((path) => ({ path, source: readFileSync(path, "utf8") }))
        .filter(({ source }) => WRITE_VERB.test(source));

    it("finds the known write sites (the guard cannot pass by scanning nothing)", () => {
        const withWrites = sources
            .filter(({ path, source }) => watchedWrites(source, path).length > 0)
            .map(({ path }) => relative(backendRoot, path));

        expect(withWrites).toEqual(
            expect.arrayContaining([
                "infrastructure/database/repositories/service-record-edit.repository.ts",
                "infrastructure/database/repositories/sb.eformsign-document-job.repository.ts",
                "infrastructure/database/repositories/sb.message-trigger-job.repository.ts",
            ]),
        );
    });

    it("every $queryRaw* write on a watched table carries RETURNING, otherwise it must be $executeRaw*", () => {
        const offenders = sources.flatMap(({ path, source }) =>
            findRawWriteViolations(source, path).map(
                (violation) =>
                    `${relative(backendRoot, path)}:${violation.line} writes [${violation.kinds.join(", ")}] via ${violation.consumer ?? "an unrecognised consumer"} without RETURNING`,
            ),
        );

        expect(offenders).toEqual([]);
    });
});
