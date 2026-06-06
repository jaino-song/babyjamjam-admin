import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { ExecutionContext } from "@nestjs/common/interfaces";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";

type MockRequest = {
    headers: Record<string, string | undefined>;
    body?: { company_id?: string };
};

const createExecutionContext = (request: MockRequest): ExecutionContext =>
    ({
        switchToHttp: () => ({
            getRequest: () => request as Request,
            getResponse: () => undefined,
            getNext: () => undefined,
        }),
    }) as ExecutionContext;

describe("WebhookGuard", () => {
    const createConfigService = (overrides?: Partial<Record<string, string | undefined>>) =>
        ({
            get: jest.fn((key: string) => overrides?.[key] ?? defaultConfig[key]),
        }) as unknown as ConfigService;

    const defaultConfig: Record<string, string | undefined> = {
        EFORMSIGN_WEBHOOK_SECRET: "webhook-secret",
        EFORMSIGN_COMPANY_ID: "company-1",
        EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS: undefined,
    };

    const createRequest = (overrides?: Partial<MockRequest>): MockRequest => ({
        headers: {
            authorization: "Bearer webhook-secret",
        },
        body: {
            company_id: "company-1",
        },
        ...overrides,
    });

    it("returns true for a valid bearer token and fallback company id", () => {
        const guard = new WebhookGuard(createConfigService());

        expect(guard.canActivate(createExecutionContext(createRequest()))).toBe(true);
    });

    it("returns true for company ids listed in EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS", () => {
        const guard = new WebhookGuard(createConfigService({
            EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS: "company-1, company-2",
        }));

        expect(guard.canActivate(createExecutionContext(createRequest({
            body: {
                company_id: "company-2",
            },
        })))).toBe(true);
    });

    it("throws 401 when the authorization header is missing", () => {
        const guard = new WebhookGuard(createConfigService());

        expect(() => guard.canActivate(createExecutionContext(createRequest({
            headers: {},
        })))).toThrow(UnauthorizedException);
    });

    it("throws 401 when the bearer token is invalid", () => {
        const guard = new WebhookGuard(createConfigService());

        expect(() => guard.canActivate(createExecutionContext(createRequest({
            headers: {
                authorization: "Bearer wrong-secret",
            },
        })))).toThrow(UnauthorizedException);
    });

    it("throws 403 when the company id is unknown", () => {
        const guard = new WebhookGuard(createConfigService({
            EFORMSIGN_WEBHOOK_ALLOWED_COMPANY_IDS: "company-1, company-2",
        }));

        expect(() => guard.canActivate(createExecutionContext(createRequest({
            body: {
                company_id: "unknown-company",
            },
        })))).toThrow(ForbiddenException);
    });

    it("treats fallback EFORMSIGN_COMPANY_ID as one literal value without splitting commas", () => {
        const guard = new WebhookGuard(createConfigService({
            EFORMSIGN_COMPANY_ID: "company-1,company-2",
        }));

        expect(guard.canActivate(createExecutionContext(createRequest({
            body: {
                company_id: "company-1,company-2",
            },
        })))).toBe(true);
        expect(() => guard.canActivate(createExecutionContext(createRequest({
            body: {
                company_id: "company-1",
            },
        })))).toThrow(ForbiddenException);
    });
});
