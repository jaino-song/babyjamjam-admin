import { CreateAreaTemplateUsecase } from "application/usecases/area-template/create-area-template.usecase";
import { UpdateAreaTemplateUsecase } from "application/usecases/area-template/update-area-template.usecase";
import { AreaTemplateEntity } from "domain/entities/area-template.entity";
import { IAreaTemplateRepository } from "domain/repositories/area-template.repository.interface";

describe("Area template usecases", () => {
    let repository: jest.Mocked<IAreaTemplateRepository>;

    beforeEach(() => {
        repository = {
            findAll: jest.fn(),
            findAvailableAreas: jest.fn(),
            findByArea: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            delete: jest.fn(),
        };
    });

    describe("CreateAreaTemplateUsecase", () => {
        it.each(["", "   "])(
            "should reject an empty templateId (%j) before repository mutation",
            (templateId) => {
                const usecase = new CreateAreaTemplateUsecase(repository);

                expect(() => usecase.execute("branch-1", "Seoul", templateId)).toThrow(
                    "Area template templateId must be a non-empty string",
                );
                expect(repository.create).not.toHaveBeenCalled();
            },
        );

        it("should pass a trimmed templateId to the repository", async () => {
            const created = new AreaTemplateEntity("id", "Seoul", "valid-template", null);
            repository.create.mockResolvedValue(created);
            const usecase = new CreateAreaTemplateUsecase(repository);

            await usecase.execute("branch-1", "Seoul", "  valid-template  ");

            expect(repository.create).toHaveBeenCalledWith(
                "branch-1",
                expect.objectContaining({ templateId: "valid-template" }),
            );
        });

        it.each([
            "d1591da29590495d800f55f1d1fc1378",
            "e63c528b0375478d83e30ff8a9ed1967",
        ])("should reject list-only historical template %s before repository mutation", (templateId) => {
            const usecase = new CreateAreaTemplateUsecase(repository);

            expect(() => usecase.execute("branch-1", "Seoul", templateId)).toThrow(
                "historical list-only",
            );
            expect(repository.create).not.toHaveBeenCalled();
        });

        it.each([
            "d1591da29590495d800f55f1d1fc1378",
            "e63c528b0375478d83e30ff8a9ed1967",
        ])("should normalize before rejecting a spaced list-only template %s", (templateId) => {
            const usecase = new CreateAreaTemplateUsecase(repository);

            expect(() => usecase.execute("branch-1", "Seoul", `  ${templateId}  `)).toThrow(
                "historical list-only",
            );
            expect(repository.create).not.toHaveBeenCalled();
        });
    });

    describe("UpdateAreaTemplateUsecase", () => {
        it.each(["", "   "])(
            "should reject an empty templateId (%j) before repository update",
            async (templateId) => {
                repository.findByArea.mockResolvedValue(
                    new AreaTemplateEntity("id", "Seoul", "existing-template", "Name"),
                );
                const usecase = new UpdateAreaTemplateUsecase(repository);

                await expect(
                    usecase.execute("branch-1", "Seoul", { templateId }),
                ).rejects.toThrow("Area template templateId must be a non-empty string");
                expect(repository.update).not.toHaveBeenCalled();
            },
        );

        it("should preserve partial update semantics while trimming templateId", async () => {
            repository.findByArea.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", "existing-template", "Name"),
            );
            repository.update.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", "valid-template", "Name"),
            );
            const usecase = new UpdateAreaTemplateUsecase(repository);

            await usecase.execute("branch-1", "Seoul", { templateId: "  valid-template  " });

            expect(repository.update).toHaveBeenCalledWith(
                "branch-1",
                expect.objectContaining({
                    templateId: "valid-template",
                    templateName: "Name",
                }),
            );
        });

        it.each([
            "d1591da29590495d800f55f1d1fc1378",
            "e63c528b0375478d83e30ff8a9ed1967",
        ])("should reject requested list-only historical template %s before update", async (templateId) => {
            repository.findByArea.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", "existing-template", "Name"),
            );
            const usecase = new UpdateAreaTemplateUsecase(repository);

            await expect(usecase.execute("branch-1", "Seoul", { templateId })).rejects.toThrow(
                "historical list-only",
            );
            expect(repository.update).not.toHaveBeenCalled();
        });

        it.each([
            "d1591da29590495d800f55f1d1fc1378",
            "e63c528b0375478d83e30ff8a9ed1967",
        ])("should normalize before rejecting a spaced requested list-only template %s", async (templateId) => {
            repository.findByArea.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", "existing-template", "Name"),
            );
            const usecase = new UpdateAreaTemplateUsecase(repository);

            await expect(usecase.execute("branch-1", "Seoul", { templateId: `  ${templateId}  ` }))
                .rejects.toThrow("historical list-only");
            expect(repository.update).not.toHaveBeenCalled();
        });

        it.each([
            "d1591da29590495d800f55f1d1fc1378",
            "e63c528b0375478d83e30ff8a9ed1967",
        ])("rejects a persisted normalized legacy row %s when only its name changes", async (templateId) => {
            repository.findByArea.mockResolvedValue(
                new AreaTemplateEntity(
                    "id",
                    "Seoul",
                    templateId,
                    "Legacy",
                ),
            );
            const usecase = new UpdateAreaTemplateUsecase(repository);

            await expect(usecase.execute("branch-1", "Seoul", { templateName: "Renamed" }))
                .rejects.toThrow("historical list-only");
            expect(repository.update).not.toHaveBeenCalled();
        });

        it.each([
            "d1591da29590495d800f55f1d1fc1378",
            "e63c528b0375478d83e30ff8a9ed1967",
        ])("allows remediating persisted legacy row %s to an active template", async (templateId) => {
            repository.findByArea.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", templateId, "Legacy"),
            );
            repository.update.mockResolvedValue(
                new AreaTemplateEntity("id", "Seoul", "active-template", "Legacy"),
            );
            const usecase = new UpdateAreaTemplateUsecase(repository);

            await usecase.execute("branch-1", "Seoul", { templateId: "  active-template  " });

            expect(repository.update).toHaveBeenCalledWith(
                "branch-1",
                expect.objectContaining({ templateId: "active-template" }),
            );
        });
    });
});
