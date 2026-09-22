import { ConfigService } from "@nestjs/config";

import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";

function createConfigService(): ConfigService {
    return {
        get: jest.fn((key: string) => ({
            EFORMSIGN_USER_EMAIL: "staff@example.com",
            EFORMSIGN_API_URL: "https://api.eformsign.example",
            EFORMSIGN_DOC_API_URL: "https://doc.eformsign.example",
            EFORMSIGN_API_KEY: "api-key",
            EFORMSIGN_PRIVATE_KEY: "00",
        }[key])),
    } as unknown as ConfigService;
}

describe("EformsignApiClient workflow config", () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("reads the complete template workflow from the forms endpoint", async () => {
        const responseBody = {
            form_id: "template-override",
            config: {
                step_settings: [
                    { seq: "3", type: "participant", step_group: "3", option: {} },
                    { seq: "1", type: "write", step_group: "1", option: {} },
                    { seq: "2", type: "participant", step_group: "2", option: {} },
                    { seq: "4", type: "complete", step_group: "4", option: {} },
                ],
            },
        };
        const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response(
            JSON.stringify(responseBody),
            { status: 200, headers: { "Content-Type": "application/json" } },
        ));
        const client = new EformsignApiClient(createConfigService());

        await expect(client.getTemplateWorkflowConfig("access-token", "template-override"))
            .resolves.toEqual(responseBody);

        expect(fetchMock).toHaveBeenCalledWith(
            "https://doc.eformsign.example/v2.0/api/forms/template-override?is_include_config=true",
            expect.objectContaining({
                headers: { Authorization: "Bearer access-token" },
                signal: expect.any(AbortSignal),
            }),
        );
    });
});
