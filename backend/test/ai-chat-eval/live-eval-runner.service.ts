import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';

export interface TestCase {
    id: string;
    category: string;
    description: string;
    input: string;
    expectedIntent: string;
    expectedTools: string[];
    expectedArgs?: Record<string, unknown>;
    responseRules?: {
        mustInclude?: string[];
        mustNotInclude?: string[];
    };
    severity?: 'critical' | 'high' | 'medium' | 'low';
}

export interface LiveEvalResult {
    testCaseId: string;
    input: string;
    actualToolCalls: { name: string; args: Record<string, unknown> }[];
    actualResponse: string;
    latencyMs: number;
    timestamp: string;
}

export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    content: string;
}

export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, { type: string; description: string; enum?: string[] }>;
        required?: string[];
    };
}

export interface FunctionCall {
    name: string;
    args: Record<string, unknown>;
}

/**
 * LiveEvalRunner - Runs test cases against the live Gemini API
 * 
 * This service sends actual queries to Gemini and captures:
 * - Tool calls made by the AI
 * - Final response text
 * - Latency metrics
 */
export class LiveEvalRunner {
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    private readonly model: string;
    private readonly apiKey: string;
    private systemPrompt: string = '';
    private tools: FunctionDeclaration[] = [];

    constructor(configService?: ConfigService) {
        this.apiKey = configService?.get<string>('GEMINI_API_KEY') || process.env['GEMINI_API_KEY'] || '';
        this.model = configService?.get<string>('GEMINI_CHAT_MODEL') || process.env['GEMINI_CHAT_MODEL'] || 'gemini-2.0-flash-lite';
    }

    /**
     * Initialize with system prompt and tools from the actual AI chat service
     */
    async initialize(): Promise<void> {
        // Load system prompt from ai-chat.service.ts
        const aiChatServicePath = path.resolve(__dirname, '../../application/services/ai-chat.service.ts');
        const serviceContent = fs.readFileSync(aiChatServicePath, 'utf-8');

        // Extract SYSTEM_PROMPT constant
        const promptMatch = serviceContent.match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/);
        if (promptMatch && promptMatch[1]) {
            this.systemPrompt = promptMatch[1];
        }

        // Load all tools
        this.tools = await this.loadAllTools();
    }

    private async loadAllTools(): Promise<FunctionDeclaration[]> {
        const toolsDir = path.resolve(__dirname, '../../application/ai-chat/tools');
        const toolFiles = fs.readdirSync(toolsDir).filter(f => f.endsWith('.tools.ts'));

        const allTools: FunctionDeclaration[] = [];

        for (const file of toolFiles) {
            const content = fs.readFileSync(path.join(toolsDir, file), 'utf-8');
            // Parse tool schemas from file content
            const schemaMatches = content.matchAll(/export const (\w+Schema): FunctionDeclaration = \{([\s\S]*?)\};/g);

            for (const match of schemaMatches) {
                try {
                    // Extract name and description for basic tool info
                    const schemaContent = match[2];
                    if (!schemaContent) continue;

                    const nameMatch = schemaContent.match(/name:\s*["'](\w+)["']/);
                    const descMatch = schemaContent.match(/description:\s*[`"']([\s\S]*?)[`"'],?\s*parameters/);

                    if (nameMatch && nameMatch[1]) {
                        allTools.push({
                            name: nameMatch[1],
                            description: descMatch?.[1] ?? '',
                            parameters: {
                                type: 'object',
                                properties: {},
                                required: [],
                            },
                        });
                    }
                } catch {
                    // Skip malformed tool definitions
                }
            }
        }

        return allTools;
    }

    /**
     * Load test cases from the dataset
     */
    loadTestCases(): TestCase[] {
        const datasetPath = path.resolve(__dirname, './eval-dataset.json');
        const dataset = JSON.parse(fs.readFileSync(datasetPath, 'utf-8'));
        return dataset.testCases;
    }

    /**
     * Run a single test case against the live Gemini API
     */
    async runTestCase(testCase: TestCase): Promise<LiveEvalResult> {
        const startTime = Date.now();

        const messages: ChatMessage[] = [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: testCase.input },
        ];

        const requestBody: Record<string, unknown> = {
            contents: messages
                .filter(m => m.role !== 'system')
                .map(m => ({
                    role: m.role === 'user' ? 'user' : 'model',
                    parts: [{ text: m.content }],
                })),
            generationConfig: {
                temperature: 0.3, // Lower temperature for more deterministic results in testing
                maxOutputTokens: 2048,
            },
            systemInstruction: { parts: [{ text: this.systemPrompt }] },
        };

        if (this.tools.length > 0) {
            requestBody['tools'] = [{ functionDeclarations: this.tools }];
            requestBody['toolConfig'] = {
                functionCallingConfig: {
                    mode: "AUTO",
                },
            };
        }

        try {
            const response = await fetch(
                `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(requestBody),
                }
            );

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
            }

            const data = await response.json();
            const candidate = data.candidates?.[0];
            const content = candidate?.content;

            const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
            let responseText = '';

            if (content?.parts) {
                for (const part of content.parts) {
                    if (part.functionCall) {
                        toolCalls.push({
                            name: part.functionCall.name,
                            args: part.functionCall.args || {},
                        });
                    }
                    if (part.text) {
                        responseText += part.text;
                    }
                }
            }

            return {
                testCaseId: testCase.id,
                input: testCase.input,
                actualToolCalls: toolCalls,
                actualResponse: responseText,
                latencyMs: Date.now() - startTime,
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            return {
                testCaseId: testCase.id,
                input: testCase.input,
                actualToolCalls: [],
                actualResponse: `ERROR: ${error instanceof Error ? error.message : 'Unknown error'}`,
                latencyMs: Date.now() - startTime,
                timestamp: new Date().toISOString(),
            };
        }
    }

    /**
     * Run all test cases
     */
    async runAllTestCases(
        options?: { category?: string; limit?: number }
    ): Promise<LiveEvalResult[]> {
        let testCases = this.loadTestCases();

        if (options?.category) {
            testCases = testCases.filter(tc => tc.category === options.category);
        }

        if (options?.limit) {
            testCases = testCases.slice(0, options.limit);
        }

        const results: LiveEvalResult[] = [];

        for (const testCase of testCases) {
            console.log(`Running test: ${testCase.id} - "${testCase.input.substring(0, 30)}..."`);
            const result = await this.runTestCase(testCase);
            results.push(result);

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return results;
    }
}
