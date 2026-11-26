import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const backendRoot = join(__dirname, "../..");
const excludedDirectories = new Set(["coverage", "dist", "generated", "node_modules", "test", "vendor", "__tests__"]);
const chunkModel = /\b(?:service_record_snapshot_chunk|serviceRecordSnapshotChunk)\b/;
const chunkRelation = /^["']?(?:snapshotChunks|serviceRecordSnapshotChunks?)["']?$/;
const prismaMutation = /^(?:update(?:Many(?:AndReturn)?)?|create(?:Many(?:AndReturn)?)?|upsert)$/;
const sqlMutation = /\b(?:UPDATE|INSERT\s+INTO|MERGE\s+INTO)\s+(?:(?:"?\w+"?)\.)?"?service_record_snapshot_chunk\b[^;`]*\blast_error\b[^;`]*/gi;

const sender = "application/usecases/eformsign-doc/create-and-send-service-record-snapshot.usecase.ts";
const lifecycle = "application/services/service-record-lifecycle.service.ts";
const allowedWriters = [
    `${lifecycle}:evaluator SQL`,
    `${sender}:markChunkCreated`,
    `${sender}:markRevisionChunkCreated`,
    `${sender}:persistRemoteDocument`,
    `${sender}:processChunk`,
    `${sender}:processChunk`,
    `${sender}:processChunk`,
    `${sender}:reconcileChunk`,
    `${sender}:reconcileChunk`,
];

function* sourceFiles(directory: string): Generator<string> {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && !excludedDirectories.has(entry.name)) {
            yield* sourceFiles(path);
        } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:spec|test)\.[jt]sx?$/.test(entry.name)) {
            yield path;
        }
    }
}

function localInitializer(identifier: ts.Identifier): ts.Expression | undefined {
    for (let scope: ts.Node | undefined = identifier.parent; scope; scope = scope.parent) {
        if (!ts.isBlock(scope)) continue;
        for (const statement of scope.statements) {
            if (!ts.isVariableStatement(statement)) continue;
            const declaration = statement.declarationList.declarations.find(item =>
                ts.isIdentifier(item.name) && item.name.text === identifier.text);
            if (declaration) return declaration.initializer;
        }
    }
    return undefined;
}

function mayWriteLastError(value: ts.Expression | undefined): boolean {
    if (!value) return true;
    if (ts.isArrayLiteralExpression(value)) return value.elements.some(mayWriteLastError);
    if (ts.isIdentifier(value)) {
        const initializer = localInitializer(value);
        return !initializer || !ts.isObjectLiteralExpression(initializer) || mayWriteLastError(initializer);
    }
    if (!ts.isObjectLiteralExpression(value)) return true;
    return value.properties.some(property => ts.isSpreadAssignment(property)
        ? mayWriteLastError(property.expression)
        : !property.name || ts.isComputedPropertyName(property.name) || /^["']?lastError["']?$/.test(property.name.getText()));
}

function mutationMayWriteLastError(argument: ts.Expression | undefined): boolean {
    if (!argument || !ts.isObjectLiteralExpression(argument)) return true;
    return argument.properties.some(property => {
        if (ts.isSpreadAssignment(property) || !property.name || ts.isComputedPropertyName(property.name)) return true;
        if (!/^["']?(?:data|create|update)["']?$/.test(property.name.getText())) return false;
        if (ts.isPropertyAssignment(property)) return mayWriteLastError(property.initializer);
        if (ts.isShorthandPropertyAssignment(property)) return mayWriteLastError(property.name);
        return true;
    });
}

function isChunkMutation(node: ts.CallExpression): boolean {
    const access = node.expression;
    if (ts.isPropertyAccessExpression(access)) {
        return prismaMutation.test(access.name.text) && chunkModel.test(access.expression.getText());
    }
    return ts.isElementAccessExpression(access) && ts.isStringLiteral(access.argumentExpression)
        && prismaMutation.test(access.argumentExpression.text) && chunkModel.test(access.expression.getText());
}

function chunkErrorWriters(file: string, source: string): string[] {
    if (!chunkModel.test(source) && !/\b(?:snapshotChunks|serviceRecordSnapshotChunks)\b/.test(source)) return [];
    const writers = [...source.matchAll(sqlMutation)].map(([sql]) =>
        `${file}:${/\bSET\s+last_error\s*=\s*\$\{initialTombstoneEvaluationRecordSql\}/i.test(sql) ? "evaluator SQL" : "unreviewed SQL"}`);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    function visit(node: ts.Node, owner: string): void {
        if (ts.isMethodDeclaration(node)) owner = node.name.getText(ast);
        if (ts.isCallExpression(node) && isChunkMutation(node) && mutationMayWriteLastError(node.arguments[0])) {
            const argument = node.arguments[0];
            const call = argument?.getText(ast) ?? "";
            const unlinked = /\bwhere\s*:\s*this\.unlinkedChunkWhere\(params\)|\bwhere\s*:\s*\{[^]*?\beformsignDocumentId:\s*null|\bwhere\s*:\s*\{\s*\.\.\.this\.unlinkedChunkWhere\(params\)/.test(call);
            writers.push(`${file}:${owner}${unlinked ? "" : " (unguarded)"}`);
        }
        if (ts.isPropertyAssignment(node) && chunkRelation.test(node.name.getText(ast))
            && /\b(?:update|updateMany|create|createMany|upsert)\s*:/.test(node.initializer.getText(ast))
            && /\blastError\b/.test(node.initializer.getText(ast))) {
            writers.push(`${file}:${owner} (nested writer)`);
        }
        ts.forEachChild(node, child => visit(child, owner));
    }
    visit(ast, "module");
    return writers;
}

describe("snapshot chunk last_error writer allowlist", () => {
    it("requires review for every writer and protects ordinary errors with an unlinked predicate", () => {
        const writers = [...sourceFiles(backendRoot)].flatMap(path =>
            chunkErrorWriters(relative(backendRoot, path), readFileSync(path, "utf8")));
        expect(writers.sort()).toEqual([...allowedWriters].sort());
        const senderSource = readFileSync(join(backendRoot, sender), "utf8");
        expect(senderSource).toMatch(/private unlinkedChunkWhere\([^]*?return \{\s*id: params\.chunkId,\s*AND: \{ eformsignDocumentId: null \},/);
    });

    it.each([
        ['tx.service_record_snapshot_chunk.update({ where: { id }, data: { lastError: null } });', "module (unguarded)"],
        ['tx.service_record_snapshot_chunk.updateMany({ where: { id }, data: patch });', "module (unguarded)"],
        ['tx["service_record_snapshot_chunk"]["update"]({ where: { id }, data: { lastError: null } });', "module (unguarded)"],
        ['tx.service_record_case.update({ data: { snapshotChunks: { updateMany: { where: { id }, data: { lastError: null } } } } });', "module (nested writer)"],
        ['Prisma.sql`UPDATE "service_record_snapshot_chunk" SET status = \'FAILED\', last_error = NULL`;', "unreviewed SQL"],
        ['Prisma.sql`INSERT INTO service_record_snapshot_chunk (id, last_error) VALUES (1, NULL)`;', "unreviewed SQL"],
    ])("detects a new writer in %s", (source, writer) => {
        expect(chunkErrorWriters("other.ts", source)).toEqual([`other.ts:${writer}`]);
    });
});
