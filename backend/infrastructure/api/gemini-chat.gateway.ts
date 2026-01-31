import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface ChatMessage {
    role: 'user' | 'model' | 'system';
    content: string;
}

export interface FunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, {
            type: string;
            description: string;
            enum?: string[];
        }>;
        required?: string[];
    };
}

export interface FunctionCall {
    name: string;
    args: Record<string, unknown>;
}

export interface GeminiStreamChunk {
    type: 'text' | 'function_call' | 'done' | 'error';
    content?: string;
    functionCall?: FunctionCall;
    error?: string;
}

@Injectable()
export class GeminiChatGateway {
    private readonly logger = new Logger(GeminiChatGateway.name);
    private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta";
    private readonly model: string;

    constructor(private readonly configService: ConfigService) {
        this.model = this.configService.get<string>("GEMINI_CHAT_MODEL") || "gemini-2.0-flash-lite";
    }

    private getApiKey(): string {
        const apiKey = this.configService.get<string>("GEMINI_API_KEY");
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY is not configured");
        }
        return apiKey;
    }

    private formatMessagesForGemini(messages: ChatMessage[]): { role: string; parts: { text: string }[] }[] {
        return messages
            .filter(m => m.role !== 'system')
            .map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content }],
            }));
    }

    private getSystemInstruction(messages: ChatMessage[]): string | undefined {
        const systemMessage = messages.find(m => m.role === 'system');
        return systemMessage?.content;
    }

    async chat(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        const apiKey = this.getApiKey();
        const systemInstruction = this.getSystemInstruction(messages);
        const formattedMessages = this.formatMessagesForGemini(messages);

        const requestBody: Record<string, unknown> = {
            contents: formattedMessages,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8192,
            },
        };

        if (systemInstruction) {
            requestBody['systemInstruction'] = { parts: [{ text: systemInstruction }] };
        }

        if (tools && tools.length > 0) {
            requestBody['tools'] = [{
                functionDeclarations: tools,
            }];
        }

        const response = await fetch(
            `${this.baseUrl}/models/${this.model}:generateContent?key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`Gemini API error: ${response.status} - ${errorText}`);
            throw new Error(`Gemini API request failed: ${response.status}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        const content = candidate?.content;

        if (!content) {
            throw new Error("Empty response from Gemini API");
        }

        const textPart = content.parts?.find((p: { text?: string }) => p.text);
        const functionCallPart = content.parts?.find((p: { functionCall?: unknown }) => p.functionCall);

        if (functionCallPart?.functionCall) {
            return {
                functionCall: {
                    name: functionCallPart.functionCall.name,
                    args: functionCallPart.functionCall.args || {},
                },
            };
        }

        return { text: textPart?.text || "" };
    }

    async *chatStream(
        messages: ChatMessage[],
        tools?: FunctionDeclaration[],
    ): AsyncGenerator<GeminiStreamChunk> {
        const apiKey = this.getApiKey();
        const systemInstruction = this.getSystemInstruction(messages);
        const formattedMessages = this.formatMessagesForGemini(messages);

        const requestBody: Record<string, unknown> = {
            contents: formattedMessages,
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8192,
            },
        };

        if (systemInstruction) {
            requestBody['systemInstruction'] = { parts: [{ text: systemInstruction }] };
        }

        if (tools && tools.length > 0) {
            requestBody['tools'] = [{
                functionDeclarations: tools,
            }];
        }

        const response = await fetch(
            `${this.baseUrl}/models/${this.model}:streamGenerateContent?alt=sse&key=${apiKey}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody),
            }
        );

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`Gemini streaming error: ${response.status} - ${errorText}`);
            yield { type: 'error', error: `Gemini API error: ${response.status}` };
            return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
            yield { type: 'error', error: 'No response body' };
            return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let doneEmitted = false;
        let shouldStop = false;

        try {
            while (!shouldStop) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr || jsonStr === '[DONE]') continue;

                        try {
                            const data = JSON.parse(jsonStr);
                            const candidate = data.candidates?.[0];
                            const content = candidate?.content;

                            if (content?.parts) {
                                for (const part of content.parts) {
                                    if (part.text) {
                                        yield { type: 'text', content: part.text };
                                    }
                                    if (part.functionCall) {
                                        yield {
                                            type: 'function_call',
                                            functionCall: {
                                                name: part.functionCall.name,
                                                args: part.functionCall.args || {},
                                            },
                                        };
                                    }
                                }
                            }

                            if (candidate?.finishReason === 'STOP') {
                                if (!doneEmitted) {
                                    doneEmitted = true;
                                    yield { type: 'done' };
                                }
                                shouldStop = true;
                                break;
                            }
                        } catch (parseError) {
                            this.logger.warn(`Failed to parse SSE chunk: ${jsonStr}`);
                        }
                    }

                    if (shouldStop) {
                        break;
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }

        if (!doneEmitted) {
            yield { type: 'done' };
        }
    }

    async sendFunctionResult(
        messages: ChatMessage[],
        functionName: string,
        result: unknown,
        tools?: FunctionDeclaration[],
    ): Promise<{ text?: string; functionCall?: FunctionCall }> {
        const messagesWithResult: ChatMessage[] = [
            ...messages,
            {
                role: 'model',
                content: JSON.stringify({ functionCall: { name: functionName } }),
            },
            {
                role: 'user',
                content: JSON.stringify({ functionResponse: { name: functionName, response: result } }),
            },
        ];

        return this.chat(messagesWithResult, tools);
    }
}
