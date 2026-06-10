import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    CallExtractionInput,
    CallExtractionPort,
    CallExtractionResult,
} from "domain/ports/call-extraction.port";
import {
    buildCallExtractionPrompt,
    CALL_EXTRACTION_RESPONSE_SCHEMA,
} from "application/services/call-extraction.prompt";

const GEMINI_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const TIMEOUT_MS = 60_000;

@Injectable()
export class GeminiCallExtractionAdapter implements CallExtractionPort {
    private readonly logger = new Logger(GeminiCallExtractionAdapter.name);

    constructor(private readonly configService: ConfigService) {}

    async extract(input: CallExtractionInput): Promise<CallExtractionResult> {
        const apiKey = this.configService.get<string>("GEMINI_API_KEY")?.trim() ?? "";
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY not configured");
        }

        const response = await fetch(GEMINI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: buildCallExtractionPrompt(input) }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: CALL_EXTRACTION_RESPONSE_SCHEMA,
                },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`Gemini extraction failed (${response.status}): ${detail.slice(0, 500)}`);
        }

        const data = (await response.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error("Gemini extraction returned no candidates");
        }

        return JSON.parse(text) as CallExtractionResult;
    }
}
