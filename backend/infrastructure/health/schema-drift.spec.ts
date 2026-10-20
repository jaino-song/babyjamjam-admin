import { findMissingColumns, listExpectedColumns, type SchemaDriftModel } from "./schema-drift";

const models: SchemaDriftModel[] = [
    {
        name: "Client",
        dbName: "client",
        fields: [
            { name: "id", kind: "scalar" },
            { name: "bookingConfirmedAt", kind: "scalar", dbName: "booking_confirmed_at" },
            { name: "status", kind: "enum" },
            { name: "bookings", kind: "object" },
        ],
    },
    {
        name: "Booking",
        dbName: null,
        fields: [
            { name: "id", kind: "scalar" },
            { name: "client", kind: "object" },
        ],
    },
];

describe("findMissingColumns", () => {
    it("should return an empty list when every expected column exists", () => {
        const existing = [
            { table_name: "client", column_name: "id" },
            { table_name: "client", column_name: "booking_confirmed_at" },
            { table_name: "client", column_name: "status" },
            { table_name: "Booking", column_name: "id" },
        ];

        expect(findMissingColumns(models, existing)).toEqual([]);
    });

    it("should list a column that the database lacks", () => {
        const existing = [
            { table_name: "client", column_name: "id" },
            { table_name: "client", column_name: "status" },
            { table_name: "Booking", column_name: "id" },
        ];

        expect(findMissingColumns(models, existing)).toEqual(["client.booking_confirmed_at"]);
    });

    it("should use @map and @@map names instead of model and field names", () => {
        const existing = [
            { table_name: "Client", column_name: "id" },
            { table_name: "client", column_name: "bookingConfirmedAt" },
            { table_name: "client", column_name: "id" },
            { table_name: "client", column_name: "status" },
            { table_name: "Booking", column_name: "id" },
        ];

        expect(findMissingColumns(models, existing)).toEqual(["client.booking_confirmed_at"]);
    });

    it("should ignore relation fields", () => {
        const expected = listExpectedColumns(models);

        expect(expected).not.toContain("client.bookings");
        expect(expected).not.toContain("Booking.client");
        expect(expected).toHaveLength(4);
    });

    it("should count enum fields as columns", () => {
        const existing = [
            { table_name: "client", column_name: "id" },
            { table_name: "client", column_name: "booking_confirmed_at" },
            { table_name: "Booking", column_name: "id" },
        ];

        expect(findMissingColumns(models, existing)).toEqual(["client.status"]);
    });

    it("should report every column of a missing table, sorted", () => {
        const existing = [
            { table_name: "client", column_name: "id" },
            { table_name: "client", column_name: "booking_confirmed_at" },
            { table_name: "client", column_name: "status" },
        ];

        expect(findMissingColumns(models, existing)).toEqual(["Booking.id"]);
        expect(findMissingColumns(models, [])).toEqual([
            "Booking.id",
            "client.booking_confirmed_at",
            "client.id",
            "client.status",
        ]);
    });
});
