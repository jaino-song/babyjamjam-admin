import {
    SystemTemplateEntity,
    VariableValidationResult,
} from "domain/entities/system-template.entity";
import { SystemTemplateVersionEntity } from "domain/entities/system-template-version.entity";
import { SystemTemplateKey } from "domain/constants/system-template-registry";

describe("SystemTemplateEntity", () => {
    const createSystemTemplateProps = (overrides = {}) => ({
        id: "template-1",
        templateKey: SystemTemplateKey.GREETING,
        content: "Welcome {{name}}, your service starts on {{date}}",
        createdAt: new Date("2025-01-14T00:00:00Z"),
        updatedAt: new Date("2025-01-14T00:00:00Z"),
        ...overrides,
    });

    describe("constructor", () => {
        it("should create a valid entity with all properties", () => {
            const props = createSystemTemplateProps();

            const entity = new SystemTemplateEntity(
                props.id,
                props.templateKey,
                props.content,
                props.createdAt,
                props.updatedAt
            );

            expect(entity.id).toBe("template-1");
            expect(entity.templateKey).toBe(SystemTemplateKey.GREETING);
            expect(entity.content).toBe("Welcome {{name}}, your service starts on {{date}}");
            expect(entity.createdAt).toEqual(props.createdAt);
            expect(entity.updatedAt).toEqual(props.updatedAt);
        });
    });

    describe("extractVariables", () => {
        it("should extract variables from content using {{variable}} regex", () => {
            const entity = new SystemTemplateEntity(
                "id",
                SystemTemplateKey.GREETING,
                "Hello {{name}}, your ID is {{id}}",
                new Date(),
                new Date()
            );

            const variables = entity.extractVariables();

            expect(variables).toEqual(["name", "id"]);
        });

        it("should handle whitespace inside braces {{ name }}", () => {
            const entity = new SystemTemplateEntity(
                "id",
                SystemTemplateKey.GREETING,
                "Hello {{ name }}, your ID is {{ id }}",
                new Date(),
                new Date()
            );

            const variables = entity.extractVariables();

            expect(variables).toEqual(["name", "id"]);
        });

        it("should return empty array when no variables", () => {
            const entity = new SystemTemplateEntity(
                "id",
                SystemTemplateKey.GREETING,
                "This is a plain text template with no variables",
                new Date(),
                new Date()
            );

            const variables = entity.extractVariables();

            expect(variables).toEqual([]);
        });

        it("should handle duplicate variables (dedupe)", () => {
            const entity = new SystemTemplateEntity(
                "id",
                SystemTemplateKey.GREETING,
                "Hello {{name}}, welcome {{name}} again. Your ID is {{id}}",
                new Date(),
                new Date()
            );

            const variables = entity.extractVariables();

            expect(variables).toEqual(["name", "id"]);
            expect(variables.length).toBe(2);
        });

        it("should handle mixed whitespace variations", () => {
            const entity = new SystemTemplateEntity(
                "id",
                SystemTemplateKey.GREETING,
                "{{name}} {{  email  }} {{ phone}}{{address }}",
                new Date(),
                new Date()
            );

            const variables = entity.extractVariables();

            expect(variables).toEqual(["name", "email", "phone", "address"]);
        });
    });

    describe("validateVariables", () => {
        describe("given all required variables are present", () => {
            it("should validate all required variables are present - success case", () => {
                const entity = new SystemTemplateEntity(
                    "id",
                    SystemTemplateKey.GREETING,
                    "Hello {{name}}, your service starts on {{date}}",
                    new Date(),
                    new Date()
                );

                const result = entity.validateVariables(["name", "date"]);

                expect(result.valid).toBe(true);
                expect(result.missingVariables).toEqual([]);
                expect(result.unknownVariables).toEqual([]);
                expect(result.syntaxErrors).toEqual([]);
            });
        });

        describe("given missing required variables", () => {
            it("should validate and detect missing required variables", () => {
                const entity = new SystemTemplateEntity(
                    "id",
                    SystemTemplateKey.GREETING,
                    "Hello {{name}}, your service starts on {{date}}",
                    new Date(),
                    new Date()
                );

                const result = entity.validateVariables(["name", "date", "email", "phone"]);

                expect(result.valid).toBe(false);
                expect(result.missingVariables).toEqual(["email", "phone"]);
                expect(result.unknownVariables).toEqual([]);
            });
        });

        describe("given undefined variables in content", () => {
            it("should detect undefined variables (in content but not required)", () => {
                const entity = new SystemTemplateEntity(
                    "id",
                    SystemTemplateKey.GREETING,
                    "Hello {{name}}, your service starts on {{date}}, contact {{support}}",
                    new Date(),
                    new Date()
                );

                const result = entity.validateVariables(["name", "date"]);

                expect(result.valid).toBe(false);
                expect(result.missingVariables).toEqual([]);
                expect(result.unknownVariables).toEqual(["support"]);
            });
        });

        describe("given both missing and unknown variables", () => {
            it("should detect both missing and unknown variables", () => {
                const entity = new SystemTemplateEntity(
                    "id",
                    SystemTemplateKey.GREETING,
                    "Hello {{name}}, contact {{support}}",
                    new Date(),
                    new Date()
                );

                const result = entity.validateVariables(["name", "date", "email"]);

                expect(result.valid).toBe(false);
                expect(result.missingVariables).toEqual(["date", "email"]);
                expect(result.unknownVariables).toEqual(["support"]);
            });
        });

        it("should return VariableValidationResult with correct structure", () => {
            const entity = new SystemTemplateEntity(
                "id",
                SystemTemplateKey.GREETING,
                "Hello {{name}}",
                new Date(),
                new Date()
            );

            const result = entity.validateVariables(["name"]);

            expect(result).toHaveProperty("valid");
            expect(result).toHaveProperty("missingVariables");
            expect(result).toHaveProperty("unknownVariables");
            expect(result).toHaveProperty("syntaxErrors");
            expect(Array.isArray(result.missingVariables)).toBe(true);
            expect(Array.isArray(result.unknownVariables)).toBe(true);
            expect(Array.isArray(result.syntaxErrors)).toBe(true);
        });

        describe("custom variables", () => {
            it("should accept custom variables as allowed keys", () => {
                // #given
                const customVariables = [{ key: "phone", label: "연락처", required: false }];
                const entity = new SystemTemplateEntity(
                    "id",
                    SystemTemplateKey.SERVICE_INFO,
                    "안내 {{name}} {{phone}}",
                    new Date(),
                    new Date(),
                    customVariables
                );

                // #when
                const result = entity.validateVariables(["name"], customVariables);

                // #then
                expect(result.valid).toBe(true);
                expect(result.missingVariables).toEqual([]);
                expect(result.unknownVariables).toEqual([]);
            });

            it("should require required custom variables to be present in content", () => {
                // #given
                const customVariables = [{ key: "phone", label: "연락처", required: true }];
                const entity = new SystemTemplateEntity(
                    "id",
                    SystemTemplateKey.SERVICE_INFO,
                    "안내 {{name}}",
                    new Date(),
                    new Date(),
                    customVariables
                );

                // #when
                const result = entity.validateVariables(["name"], customVariables);

                // #then
                expect(result.valid).toBe(false);
                expect(result.missingVariables).toEqual(["phone"]);
            });

            it("should report unknown variables not in registry or custom variables", () => {
                // #given
                const customVariables = [{ key: "phone", label: "연락처", required: false }];
                const entity = new SystemTemplateEntity(
                    "id",
                    SystemTemplateKey.SERVICE_INFO,
                    "안내 {{name}} {{fax}}",
                    new Date(),
                    new Date(),
                    customVariables
                );

                // #when
                const result = entity.validateVariables(["name"], customVariables);

                // #then
                expect(result.valid).toBe(false);
                expect(result.unknownVariables).toEqual(["fax"]);
            });
        });
    });

    describe("updateContent", () => {
        it("should update content and timestamp", () => {
            const entity = new SystemTemplateEntity(
                "id",
                SystemTemplateKey.GREETING,
                "Old content",
                new Date("2025-01-01T00:00:00Z"),
                new Date("2025-01-01T00:00:00Z")
            );
            const beforeUpdate = new Date();

            entity.updateContent("New content with {{variable}}");

            expect(entity.content).toBe("New content with {{variable}}");
            expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeUpdate.getTime());
        });
    });

    describe("create", () => {
        it("should create a new template with current timestamp", () => {
            const beforeCreate = new Date();

            const entity = SystemTemplateEntity.create(SystemTemplateKey.GREETING, "Hello {{name}}");

            expect(entity.id).toBe("");
            expect(entity.templateKey).toBe(SystemTemplateKey.GREETING);
            expect(entity.content).toBe("Hello {{name}}");
            expect(entity.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
            expect(entity.updatedAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
        });
    });

    describe("reconstitute", () => {
        it("should reconstitute entity from persisted data", () => {
            const createdAt = new Date("2025-01-01T00:00:00Z");
            const updatedAt = new Date("2025-01-14T00:00:00Z");

            const entity = SystemTemplateEntity.reconstitute(
                "template-1",
                SystemTemplateKey.GREETING,
                "Hello {{name}}",
                createdAt,
                updatedAt
            );

            expect(entity.id).toBe("template-1");
            expect(entity.templateKey).toBe(SystemTemplateKey.GREETING);
            expect(entity.content).toBe("Hello {{name}}");
            expect(entity.createdAt).toEqual(createdAt);
            expect(entity.updatedAt).toEqual(updatedAt);
        });
    });
});

describe("SystemTemplateVersionEntity", () => {
    const createSystemTemplateVersionProps = (overrides = {}) => ({
        id: "version-1",
        templateId: "template-1",
        content: "Version content with {{variable}}",
        versionNumber: 1,
        createdBy: "user-123",
        createdAt: new Date("2025-01-14T00:00:00Z"),
        ...overrides,
    });

    describe("constructor", () => {
        it("should create a valid version entity", () => {
            const props = createSystemTemplateVersionProps();

            const entity = new SystemTemplateVersionEntity(
                props.id,
                props.templateId,
                props.content,
                props.versionNumber,
                props.createdBy,
                props.createdAt
            );

            expect(entity.id).toBe("version-1");
            expect(entity.templateId).toBe("template-1");
            expect(entity.content).toBe("Version content with {{variable}}");
            expect(entity.versionNumber).toBe(1);
            expect(entity.createdBy).toBe("user-123");
            expect(entity.createdAt).toEqual(props.createdAt);
        });

        it("should have correct properties", () => {
            const entity = new SystemTemplateVersionEntity(
                "v1",
                "t1",
                "content",
                2,
                null,
                new Date()
            );

            expect(entity).toHaveProperty("id");
            expect(entity).toHaveProperty("templateId");
            expect(entity).toHaveProperty("content");
            expect(entity).toHaveProperty("versionNumber");
            expect(entity).toHaveProperty("createdBy");
            expect(entity).toHaveProperty("createdAt");
        });
    });

    describe("create", () => {
        it("should create a new version with current timestamp", () => {
            const beforeCreate = new Date();

            const entity = SystemTemplateVersionEntity.create(
                "template-1",
                "Version content",
                1,
                "user-123"
            );

            expect(entity.id).toBe("");
            expect(entity.templateId).toBe("template-1");
            expect(entity.content).toBe("Version content");
            expect(entity.versionNumber).toBe(1);
            expect(entity.createdBy).toBe("user-123");
            expect(entity.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
        });

        it("should handle null createdBy", () => {
            const entity = SystemTemplateVersionEntity.create(
                "template-1",
                "Version content",
                1,
                null
            );

            expect(entity.createdBy).toBeNull();
        });
    });

    describe("reconstitute", () => {
        it("should reconstitute version entity from persisted data", () => {
            const createdAt = new Date("2025-01-14T00:00:00Z");

            const entity = SystemTemplateVersionEntity.reconstitute(
                "version-1",
                "template-1",
                "Version content",
                2,
                "user-123",
                createdAt
            );

            expect(entity.id).toBe("version-1");
            expect(entity.templateId).toBe("template-1");
            expect(entity.content).toBe("Version content");
            expect(entity.versionNumber).toBe(2);
            expect(entity.createdBy).toBe("user-123");
            expect(entity.createdAt).toEqual(createdAt);
        });
    });
});
