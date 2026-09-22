import { BadRequestException } from "@nestjs/common";

import { CreateMessageTemplateUsecase } from "application/usecases/message-template/create-message-template.usecase";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository } from "domain/repositories/message-template.repository.interface";

describe("CreateMessageTemplateUsecase required fields", () => {
    function setup() {
        const repository: jest.Mocked<IMessageTemplateRepository> = {
            findById: jest.fn(),
            findAll: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            updateIfVersionMatches: jest.fn(),
            delete: jest.fn(),
        };
        const usecase = new CreateMessageTemplateUsecase(repository);
        return { repository, usecase };
    }

    it.each([
        ["name", { name: " \n", content: "정상 내용", variables: [] }],
        ["content", { name: "정상 이름", content: "\t\r\n", variables: [] }],
    ])("rejects whitespace-only %s before repository creation", async (_field, input) => {
        const { repository, usecase } = setup();

        await expect(usecase.execute("branch-a", input)).rejects.toBeInstanceOf(BadRequestException);

        expect(repository.create).not.toHaveBeenCalled();
    });

    it("preserves valid multiline name and content without trimming", async () => {
        const { repository, usecase } = setup();
        const name = "  QA 생성 템플릿  ";
        const content = "첫 줄\n둘째 줄\n\t셋째 줄  ";
        repository.create.mockImplementation(async (_branchId, template) => template);

        await usecase.execute("branch-a", { name, content, variables: [] });

        const created = repository.create.mock.calls[0]?.[1];
        expect(created).toBeInstanceOf(MessageTemplateEntity);
        expect(created?.name).toBe(name);
        expect(created?.content).toBe(content);
    });
});
