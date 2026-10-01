import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { BroadcastNotificationDto, SendNotificationDto } from "./notification.dto";

async function validationErrors<T extends object>(type: new () => T, payload: object) {
    return validate(plainToInstance(type, payload), {
        whitelist: true,
        forbidNonWhitelisted: true,
    });
}

const BASE_SEND = { userId: "user-1", title: "제목", body: "본문" };
const BASE_BROADCAST = { title: "제목", body: "본문" };

describe.each([
    ["SendNotificationDto", SendNotificationDto, BASE_SEND],
    ["BroadcastNotificationDto", BroadcastNotificationDto, BASE_BROADCAST],
])("%s data.url restriction", (_name, DtoClass, base) => {
    it("accepts a request with no data", async () => {
        const errors = await validationErrors(DtoClass, { ...base });
        expect(errors).toEqual([]);
    });

    it("accepts a same-origin relative url", async () => {
        const errors = await validationErrors(DtoClass, { ...base, data: { url: "/clients" } });
        expect(errors).toEqual([]);
    });

    it("rejects an external https url", async () => {
        const errors = await validationErrors(DtoClass, { ...base, data: { url: "https://evil.example.com/phish" } });
        expect(errors.some((error) => error.property === "data")).toBe(true);
    });

    it("rejects a protocol-relative url", async () => {
        const errors = await validationErrors(DtoClass, { ...base, data: { url: "//evil.example.com" } });
        expect(errors.some((error) => error.property === "data")).toBe(true);
    });

    it("rejects a backslash-prefixed url", async () => {
        const errors = await validationErrors(DtoClass, { ...base, data: { url: "/\\evil.example.com" } });
        expect(errors.some((error) => error.property === "data")).toBe(true);
    });

    it("rejects a non-string url", async () => {
        const errors = await validationErrors(DtoClass, { ...base, data: { url: 12345 } });
        expect(errors.some((error) => error.property === "data")).toBe(true);
    });

    it("rejects oversized data payloads", async () => {
        const errors = await validationErrors(DtoClass, {
            ...base,
            data: { url: "/clients", padding: "x".repeat(3000) },
        });
        expect(errors.some((error) => error.property === "data")).toBe(true);
    });
});
