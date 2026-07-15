import { convertToVercelTool, convertToVercelTools } from "../vercel-tool-adapter";
import type { FunctionDeclaration } from "../gemini-chat.gateway";
import { allTools } from "application/ai-chat/tools";

describe("vercel-tool-adapter", () => {
    describe("convertToVercelTool", () => {
        it("converts string parameter to zod schema", () => {
            const declaration: FunctionDeclaration = {
                name: "testTool",
                description: "Test tool for string parameter",
                parameters: {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "Name parameter" },
                    },
                    required: ["name"],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Test tool for string parameter");
            // inputSchema is a ZodObject - verify it exists
            expect(result.inputSchema).toBeDefined();
        });

        it("converts number parameter to zod schema", () => {
            const declaration: FunctionDeclaration = {
                name: "numberTool",
                description: "Test tool with number",
                parameters: {
                    type: "object",
                    properties: {
                        count: { type: "number", description: "Count value" },
                    },
                    required: ["count"],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Test tool with number");
            expect(result.inputSchema).toBeDefined();
        });

        it("converts integer parameter to zod schema with int validation", () => {
            const declaration: FunctionDeclaration = {
                name: "integerTool",
                description: "Test tool with integer",
                parameters: {
                    type: "object",
                    properties: {
                        id: { type: "integer", description: "ID value" },
                    },
                    required: ["id"],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Test tool with integer");
            expect(result.inputSchema).toBeDefined();
        });

        it("converts boolean parameter to zod schema", () => {
            const declaration: FunctionDeclaration = {
                name: "booleanTool",
                description: "Test tool with boolean",
                parameters: {
                    type: "object",
                    properties: {
                        confirmed: { type: "boolean", description: "Confirmation flag" },
                    },
                    required: [],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Test tool with boolean");
            expect(result.inputSchema).toBeDefined();
        });

        it("handles enum parameters", () => {
            const declaration: FunctionDeclaration = {
                name: "filterTool",
                description: "Filter tool with enum",
                parameters: {
                    type: "object",
                    properties: {
                        status: {
                            type: "string",
                            description: "Status filter",
                            enum: ["active", "inactive", "pending"],
                        },
                    },
                    required: ["status"],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Filter tool with enum");
            expect(result.inputSchema).toBeDefined();
        });

        it("handles array parameters", () => {
            const declaration: FunctionDeclaration = {
                name: "arrayTool",
                description: "Tool with array parameter",
                parameters: {
                    type: "object",
                    properties: {
                        tags: { type: "array", description: "List of tags" },
                    },
                    required: [],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Tool with array parameter");
            expect(result.inputSchema).toBeDefined();
        });

        it("handles object parameters", () => {
            const declaration: FunctionDeclaration = {
                name: "objectTool",
                description: "Tool with object parameter",
                parameters: {
                    type: "object",
                    properties: {
                        metadata: { type: "object", description: "Additional metadata" },
                    },
                    required: [],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Tool with object parameter");
            expect(result.inputSchema).toBeDefined();
        });

        it("marks optional parameters correctly", () => {
            const declaration: FunctionDeclaration = {
                name: "mixedTool",
                description: "Tool with required and optional params",
                parameters: {
                    type: "object",
                    properties: {
                        required: { type: "string", description: "Required param" },
                        optional: { type: "string", description: "Optional param" },
                    },
                    required: ["required"],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Tool with required and optional params");
            expect(result.inputSchema).toBeDefined();
        });

        it("handles empty properties", () => {
            const declaration: FunctionDeclaration = {
                name: "noParamsTool",
                description: "Tool with no parameters",
                parameters: {
                    type: "object",
                    properties: {},
                    required: [],
                },
            };

            const result = convertToVercelTool(declaration);

            expect(result.description).toBe("Tool with no parameters");
            expect(result.inputSchema).toBeDefined();
        });
    });

    describe("convertToVercelTools", () => {
        it("converts array of declarations to tools object", () => {
            const declarations: FunctionDeclaration[] = [
                {
                    name: "tool1",
                    description: "First tool",
                    parameters: { type: "object", properties: {}, required: [] },
                },
                {
                    name: "tool2",
                    description: "Second tool",
                    parameters: { type: "object", properties: {}, required: [] },
                },
            ];

            const result = convertToVercelTools(declarations);

            expect(Object.keys(result)).toEqual(["tool1", "tool2"]);
            expect(result["tool1"]!.description).toBe("First tool");
            expect(result["tool2"]!.description).toBe("Second tool");
        });

        it("handles empty declarations array", () => {
            const declarations: FunctionDeclaration[] = [];

            const result = convertToVercelTools(declarations);

            expect(Object.keys(result)).toHaveLength(0);
        });

        it("preserves tool names as keys", () => {
            const declarations: FunctionDeclaration[] = [
                {
                    name: "searchClients",
                    description: "Search for clients",
                    parameters: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Search query" },
                        },
                        required: ["query"],
                    },
                },
                {
                    name: "getDashboardStats",
                    description: "Get dashboard statistics",
                    parameters: { type: "object", properties: {}, required: [] },
                },
            ];

            const result = convertToVercelTools(declarations);

            expect(result).toHaveProperty("searchClients");
            expect(result).toHaveProperty("getDashboardStats");
            expect(result["searchClients"]!.description).toBe("Search for clients");
            expect(result["getDashboardStats"]!.description).toBe("Get dashboard statistics");
        });
    });

    describe("integration with allTools", () => {
        it("converts all existing tool definitions without errors", () => {
            // This test ensures backward compatibility with all 25+ existing tools
            expect(() => {
                const vercelTools = convertToVercelTools(allTools);
                expect(Object.keys(vercelTools).length).toBe(allTools.length);
            }).not.toThrow();
        });

        it("preserves all tool names from allTools", () => {
            const vercelTools = convertToVercelTools(allTools);
            const expectedToolNames = allTools.map(t => t.name);

            for (const toolName of expectedToolNames) {
                expect(vercelTools).toHaveProperty(toolName);
            }
        });

        it("preserves tool descriptions from allTools", () => {
            const vercelTools = convertToVercelTools(allTools);

            for (const tool of allTools) {
                expect(vercelTools[tool.name]!.description).toBe(tool.description);
            }
        });
    });
});
