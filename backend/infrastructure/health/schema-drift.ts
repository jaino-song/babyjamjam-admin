export interface SchemaDriftField {
    readonly name: string;
    readonly kind: string;
    readonly dbName?: string | null;
}

export interface SchemaDriftModel {
    readonly name: string;
    readonly dbName?: string | null;
    readonly fields: readonly SchemaDriftField[];
}

export interface ExistingColumn {
    readonly table_name: string;
    readonly column_name: string;
}

const COLUMN_KINDS: ReadonlySet<string> = new Set(["scalar", "enum"]);

/**
 * Every `table.column` the Prisma schema expects the database to hold.
 * Relation (`object`) and any other non-column kinds are skipped; `@map`/`@@map`
 * names (dbName) win over the model/field names.
 */
export function listExpectedColumns(models: readonly SchemaDriftModel[]): string[] {
    const expected: string[] = [];

    for (const model of models) {
        const table = model.dbName ?? model.name;
        for (const field of model.fields) {
            if (!COLUMN_KINDS.has(field.kind)) {
                continue;
            }
            expected.push(`${table}.${field.dbName ?? field.name}`);
        }
    }

    return expected;
}

/**
 * Expected columns that are absent from `existing`, as sorted `table.column`
 * strings. Compared as exact strings; a missing table reports all its columns.
 */
export function findMissingColumns(
    models: readonly SchemaDriftModel[],
    existing: readonly ExistingColumn[],
): string[] {
    const present = new Set(existing.map((row) => `${row.table_name}.${row.column_name}`));

    return listExpectedColumns(models)
        .filter((column) => !present.has(column))
        .sort();
}
