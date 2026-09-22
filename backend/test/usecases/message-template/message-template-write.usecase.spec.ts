import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

import { CreateMessageTemplateUsecase } from "application/usecases/message-template/create-message-template.usecase";
import { DeleteMessageTemplateUsecase } from "application/usecases/message-template/delete-message-template.usecase";
import { FindMessageTemplateByIdUsecase } from "application/usecases/message-template/find-message-template-by-id.usecase";
import { GetMessageTemplateUsecase } from "application/usecases/message-template/get-message-template.usecase";
import { UpdateMessageTemplateUsecase } from "application/usecases/message-template/update-message-template.usecase";
import { MessageTemplateEntity } from "domain/entities/message-template.entity";
import { IMessageTemplateRepository } from "domain/repositories/message-template.repository.interface";

function repositoryStub(): jest.Mocked<IMessageTemplateRepository> {
    return {
        findById: jest.fn(),
        findAll: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateIfVersionMatches: jest.fn(),
        delete: jest.fn(),
    };
}

function template(): MessageTemplateEntity {
    return MessageTemplateEntity.reconstitute(
        "template-1",
        "지점 템플릿",
        "안녕하세요 {{이름}}",
        [{ key: "이름", type: "text", label: "이름", required: true }],
        new Date("2026-07-27T00:00:00.000Z"),
        new Date("2026-07-27T00:00:00.000Z"),
    );
}

describe("message template usecases (problem contract)", () => {
    it("create rejects variable mismatches with a VALIDATION_FAILED /variables body", async () => {
        const repository = repositoryStub();
        const usecase = new CreateMessageTemplateUsecase(repository);

        const error: unknown = await usecase.execute("branch-a", {
            name: "깨진 템플릿",
            content: "안녕하세요 {{정의되지않은변수}}",
            variables: [],
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            errors: expect.arrayContaining([
                expect.objectContaining({ pointer: "/variables", location: "body" }),
            ]),
        });
        expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
        ["delete", (repository: jest.Mocked<IMessageTemplateRepository>) => new DeleteMessageTemplateUsecase(repository)],
        ["find", (repository: jest.Mocked<IMessageTemplateRepository>) => new FindMessageTemplateByIdUsecase(repository)],
        ["get", (repository: jest.Mocked<IMessageTemplateRepository>) => new GetMessageTemplateUsecase(repository)],
    ])("%s reports the registered RESOURCE_NOT_FOUND body without the template id", async (_label, make) => {
        const repository = repositoryStub();
        repository.findById.mockResolvedValue(null);
        const usecase = make(repository) as unknown as { execute(branchId: string, id: string): Promise<unknown> };

        const error: unknown = await usecase.execute("branch-a", "template-1")
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
            code: "RESOURCE_NOT_FOUND",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            message: expect.not.stringContaining("template-1"),
        });
    });

    it("update reports the registered RESOURCE_NOT_FOUND body without the template id", async () => {
        const repository = repositoryStub();
        repository.findById.mockResolvedValue(null);
        const usecase = new UpdateMessageTemplateUsecase(repository);

        const error: unknown = await usecase.execute("branch-a", "template-1", { name: "새 이름" })
            .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(NotFoundException);
        expect((error as NotFoundException).getResponse()).toEqual({
            code: "RESOURCE_NOT_FOUND",
            params: {},
            outcome: "NOT_APPLIED",
            recovery: { action: "NONE", retry: { mode: "NEVER" } },
            message: expect.not.stringContaining("template-1"),
        });
    });

    it("update rejects variable mismatches with a VALIDATION_FAILED /variables body", async () => {
        const repository = repositoryStub();
        repository.findById.mockResolvedValue(template());
        const usecase = new UpdateMessageTemplateUsecase(repository);

        const error: unknown = await usecase.execute("branch-a", "template-1", {
            content: "안녕하세요 {{정의되지않은변수}}",
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(BadRequestException);
        expect((error as BadRequestException).getResponse()).toMatchObject({
            code: "VALIDATION_FAILED",
            errors: expect.arrayContaining([
                expect.objectContaining({ pointer: "/variables", location: "body" }),
            ]),
        });
        expect(repository.update).not.toHaveBeenCalled();
    });

    it("executeApproved rejects a missing approval snapshot with the write-target conflict code", async () => {
        const repository = repositoryStub();
        const usecase = new UpdateMessageTemplateUsecase(repository);

        const error: unknown = await usecase.executeApproved(
            "branch-a",
            "template-1",
            { name: "새 이름" },
            new Date("2026-07-27T00:00:00.000Z"),
            undefined,
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
        });
        expect(repository.updateIfVersionMatches).not.toHaveBeenCalled();
    });

    it("executeApproved maps a lost version race to the write-target conflict code", async () => {
        const repository = repositoryStub();
        repository.updateIfVersionMatches.mockResolvedValue(null);
        const usecase = new UpdateMessageTemplateUsecase(repository);
        const existing = template();

        const error: unknown = await usecase.executeApproved(
            "branch-a",
            "template-1",
            { name: "새 이름" },
            existing.updatedAt,
            {
                id: "template-1",
                name: existing.name,
                content: existing.content,
                variables: existing.variables,
                createdAt: existing.createdAt.toISOString(),
                updatedAt: existing.updatedAt.toISOString(),
            },
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
            code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
        });
    });
});
