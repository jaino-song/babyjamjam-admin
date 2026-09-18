import { BadRequestException } from "@nestjs/common";

import { UpdateMessageTemplateUsecase } from "application/usecases/message-template/update-message-template.usecase";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository } from "domain/repositories/message-template.repository.interface";

describe("UpdateMessageTemplateUsecase required fields", () => {
    const createdAt = new Date("2026-09-18T00:00:00.000Z");
    const updatedAt = new Date("2026-09-18T01:00:00.000Z");

    function setup(existing = MessageTemplateEntity.reconstitute(
        "template-a",
        "기존 이름",
        "기존 내용",
        [],
        createdAt,
        updatedAt,
    )) {
        const repository: jest.Mocked<IMessageTemplateRepository> = {
            findById: jest.fn().mockResolvedValue(existing),
            findAll: jest.fn(),
            create: jest.fn(),
            update: jest.fn().mockImplementation(async (_branchId, template) => template),
            updateIfVersionMatches: jest.fn().mockImplementation(async (_branchId, _id, _version, template) => template),
            delete: jest.fn(),
        };
        const usecase = new UpdateMessageTemplateUsecase(repository);
        return { repository, usecase, existing };
    }

    it.each([
        ["name", { name: "  \n" }],
        ["content", { content: "\t\r\n" }],
    ])("rejects whitespace-only %s before normal repository update", async (_field, params) => {
        const { repository, usecase } = setup();

        await expect(usecase.execute("branch-a", "template-a", params)).rejects.toBeInstanceOf(BadRequestException);

        expect(repository.update).not.toHaveBeenCalled();
    });

    it("allows omitted name and content for a partial update of a legacy blank row", async () => {
        const legacy = MessageTemplateEntity.reconstitute(
            "template-a",
            "",
            "",
            [],
            createdAt,
            updatedAt,
        );
        const { repository, usecase } = setup(legacy);

        await usecase.execute("branch-a", "template-a", { variables: [] });

        expect(repository.update).toHaveBeenCalledTimes(1);
        const updated = repository.update.mock.calls[0]?.[1];
        expect(updated?.name).toBe("");
        expect(updated?.content).toBe("");
    });

    it("preserves valid multiline update strings without trimming or rewriting", async () => {
        const { repository, usecase } = setup();
        const name = "  QA 수정 템플릿  ";
        const content = "첫 줄\n둘째 줄\n\t셋째 줄  ";

        await usecase.execute("branch-a", "template-a", { name, content });

        const updated = repository.update.mock.calls[0]?.[1];
        expect(updated?.name).toBe(name);
        expect(updated?.content).toBe(content);
    });

    it("rejects whitespace-only approved updates before compare-and-set mutation", async () => {
        const { repository, usecase } = setup();
        const snapshot = {
            id: "template-a",
            name: "기존 이름",
            content: "기존 내용",
            variables: [],
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
        };

        await expect(usecase.executeApproved(
            "branch-a",
            "template-a",
            { name: " \n" },
            updatedAt,
            snapshot,
        )).rejects.toBeInstanceOf(BadRequestException);

        expect(repository.updateIfVersionMatches).not.toHaveBeenCalled();
    });

    it("allows omitted fields and preserves valid multiline approved updates", async () => {
        const { repository, usecase } = setup();
        const name = "  승인 템플릿  ";
        const content = "승인 첫 줄\n승인 둘째 줄\n";
        const snapshot = {
            id: "template-a",
            name: "기존 이름",
            content: "기존 내용",
            variables: [],
            createdAt: createdAt.toISOString(),
            updatedAt: updatedAt.toISOString(),
        };

        await usecase.executeApproved(
            "branch-a",
            "template-a",
            { name, content },
            updatedAt,
            snapshot,
        );

        const updated = repository.updateIfVersionMatches.mock.calls[0]?.[3];
        expect(updated?.name).toBe(name);
        expect(updated?.content).toBe(content);
    });
});
