import { ConfigService } from '@nestjs/config';
import { TestCase, LiveEvalResult } from './live-eval-runner.service';

export interface JudgeScore {
    intentRecognition: number;  // 0-10: Did AI understand the user's intent?
    toolSelection: number;      // 0-10: Were correct tools selected?
    argumentAccuracy: number;   // 0-10: Were tool arguments correct?
    responseRelevance: number;  // 0-10: Is response relevant to query?
    noHallucination: number;    // 0-10: Did AI avoid fabricating info?
}

export interface JudgeResult {
    testCaseId: string;
    scores: JudgeScore;
    weightedScore: number;      // 0-10 weighted average
    passed: boolean;            // weightedScore >= 7.0
    issues: string[];           // List of identified problems
    suggestedFix: string | null; // Specific improvement suggestion
    reasoning: string;          // Judge's explanation
    toolsCalled: string[];      // Actual tools that were called
}

const JUDGE_SYSTEM_PROMPT = `You are an AI quality evaluator for a Korean postpartum care management back-office system.

Your job is to evaluate AI assistant responses against expected behavior. Be STRICT and SPECIFIC.

The back-office manages:
- 산모 (clients/mothers receiving care)
- 제공인력/관리사/이모님 (employees/caregivers providing care)
- Contracts, schedules, vouchers, bank accounts, messages

CRITICAL TERMINOLOGY:
- 제공인력 = 관리사 = 이모님 = 직원 = employees (service PROVIDERS)
- 산모 = 이용자 = 고객 = 엄마 = clients (service RECIPIENTS)

These are NEVER interchangeable. Confusing them is a CRITICAL error.`;

const SCORE_WEIGHTS = {
    intentRecognition: 0.25,
    toolSelection: 0.30,
    argumentAccuracy: 0.15,
    responseRelevance: 0.15,
    noHallucination: 0.15,
};

/**
 * LLMJudge - Uses Gemini to evaluate AI chat responses
 * 
 * This service acts as an automated quality evaluator:
 * - Scores responses on 5 weighted criteria
 * - Identifies specific issues
 * - Generates improvement suggestions
 */
export class LLMJudge {
    private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    private readonly model: string;
    private readonly apiKey: string;

    constructor(configService?: ConfigService) {
        this.apiKey = configService?.get<string>('GEMINI_API_KEY') || process.env['GEMINI_API_KEY'] || '';
        this.model = configService?.get<string>('GEMINI_CHAT_MODEL') || process.env['GEMINI_CHAT_MODEL'] || 'gemini-2.0-flash-lite';
    }

    /**
     * Evaluate a single test case result
     */
    async evaluate(testCase: TestCase, result: LiveEvalResult): Promise<JudgeResult> {
        const actualToolNames = result.actualToolCalls.map(tc => tc.name.toLowerCase());
        const expectedToolNames = testCase.expectedTools.map(t => t.toLowerCase());

        const prompt = this.buildEvaluationPrompt(testCase, result);

        try {
            const response = await fetch(
                `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        systemInstruction: { parts: [{ text: JUDGE_SYSTEM_PROMPT }] },
                        generationConfig: {
                            temperature: 0.1, // Low temp for consistent evaluation
                            maxOutputTokens: 1024,
                            responseMimeType: 'application/json',
                        },
                    }),
                }
            );

            if (!response.ok) {
                throw new Error(`Judge API error: ${response.status}`);
            }

            const data = await response.json();
            const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

            if (!content) {
                throw new Error('Empty judge response');
            }

            const parsed = JSON.parse(content);
            return this.processJudgeResponse(testCase.id, parsed, actualToolNames);
        } catch (error) {
            // Fallback to rule-based evaluation if LLM judge fails
            return this.fallbackEvaluation(testCase, result, actualToolNames, expectedToolNames);
        }
    }

    private buildEvaluationPrompt(testCase: TestCase, result: LiveEvalResult): string {
        const actualToolsStr = result.actualToolCalls.length > 0
            ? result.actualToolCalls.map(tc => `${tc.name}(${JSON.stringify(tc.args)})`).join(', ')
            : 'NONE';

        return `Evaluate this AI assistant response:

## Test Case
- **ID**: ${testCase.id}
- **Category**: ${testCase.category}
- **User Input**: "${testCase.input}"
- **Expected Intent**: ${testCase.expectedIntent}
- **Expected Tools**: ${testCase.expectedTools.join(', ') || 'NONE (conversation only)'}
${testCase.expectedArgs ? `- **Expected Args**: ${JSON.stringify(testCase.expectedArgs)}` : ''}
${testCase.responseRules?.mustInclude ? `- **Response Must Include**: ${testCase.responseRules.mustInclude.join(', ')}` : ''}
${testCase.responseRules?.mustNotInclude ? `- **Response Must NOT Include**: ${testCase.responseRules.mustNotInclude.join(', ')}` : ''}

## Actual Result
- **Tools Called**: ${actualToolsStr}
- **Response**: "${result.actualResponse.substring(0, 500)}${result.actualResponse.length > 500 ? '...' : ''}"

## Evaluation Instructions
Score each criterion 0-10 (10 = perfect):

1. **intentRecognition** (25%): Did the AI correctly understand what the user wanted?
   - 10: Perfect understanding
   - 7-9: Correct intent, minor nuance missed
   - 4-6: Partially correct
   - 1-3: Mostly wrong
   - 0: Completely misunderstood

2. **toolSelection** (30%): Did the AI call the correct tool(s)?
   - 10: Exact match with expected tools
   - 7-9: Correct primary tool, minor variations acceptable
   - 4-6: Related but wrong tool
   - 1-3: Wrong category of tool
   - 0: No tool when needed, or wrong tool entirely

3. **argumentAccuracy** (15%): Were the tool arguments correct?
   - 10: All arguments correct
   - 7-9: Minor argument issues
   - 4-6: Some arguments wrong
   - 0-3: Major argument errors

4. **responseRelevance** (15%): Does the response address the user's need?
   - 10: Perfectly relevant and helpful
   - 7-9: Relevant with minor issues
   - 4-6: Partially relevant
   - 0-3: Not relevant

5. **noHallucination** (15%): Did the AI avoid making up information?
   - 10: No fabrication
   - 5: Minor assumptions
   - 0: Made up data

Return a JSON object with this EXACT structure:
{
  "scores": {
    "intentRecognition": <number 0-10>,
    "toolSelection": <number 0-10>,
    "argumentAccuracy": <number 0-10>,
    "responseRelevance": <number 0-10>,
    "noHallucination": <number 0-10>
  },
  "issues": ["<specific issue 1>", "<specific issue 2>"],
  "suggestedFix": "<specific prompt improvement suggestion or null>",
  "reasoning": "<brief explanation of your evaluation>"
}`;
    }

    private processJudgeResponse(testCaseId: string, parsed: {
        scores: JudgeScore;
        issues?: string[];
        suggestedFix?: string;
        reasoning?: string;
    }, toolsCalled: string[]): JudgeResult {
        const scores = parsed.scores;

        // Calculate weighted score
        const weightedScore =
            scores.intentRecognition * SCORE_WEIGHTS.intentRecognition +
            scores.toolSelection * SCORE_WEIGHTS.toolSelection +
            scores.argumentAccuracy * SCORE_WEIGHTS.argumentAccuracy +
            scores.responseRelevance * SCORE_WEIGHTS.responseRelevance +
            scores.noHallucination * SCORE_WEIGHTS.noHallucination;

        return {
            testCaseId,
            scores,
            weightedScore: Math.round(weightedScore * 100) / 100,
            passed: weightedScore >= 7.0,
            issues: parsed.issues || [],
            suggestedFix: parsed.suggestedFix || null,
            reasoning: parsed.reasoning || '',
            toolsCalled,
        };
    }

    private fallbackEvaluation(
        testCase: TestCase,
        result: LiveEvalResult,
        actualToolNames: string[],
        expectedToolNames: string[]
    ): JudgeResult {
        const issues: string[] = [];
        let suggestedFix: string | null = null;

        // Tool selection check
        const toolMatch = expectedToolNames.length === 0
            ? actualToolNames.length === 0
            : expectedToolNames.some(expected => actualToolNames.includes(expected));

        const toolScore = toolMatch ? 10 : 0;
        if (!toolMatch && expectedToolNames.length > 0) {
            issues.push(`Expected tools: ${expectedToolNames.join(', ')}, got: ${actualToolNames.join(', ') || 'none'}`);
            suggestedFix = `Add example: "${testCase.input}" → ${expectedToolNames[0]}`;
        }

        // Response rules check
        let responseScore = 7; // Base score
        if (testCase.responseRules) {
            if (testCase.responseRules.mustInclude) {
                const missing = testCase.responseRules.mustInclude.filter(
                    term => !result.actualResponse.toLowerCase().includes(term.toLowerCase())
                );
                if (missing.length > 0) {
                    responseScore -= 3;
                    issues.push(`Response missing required terms: ${missing.join(', ')}`);
                }
            }
            if (testCase.responseRules.mustNotInclude) {
                const forbidden = testCase.responseRules.mustNotInclude.filter(
                    term => result.actualResponse.toLowerCase().includes(term.toLowerCase())
                );
                if (forbidden.length > 0) {
                    responseScore -= 5;
                    issues.push(`Response contains forbidden terms: ${forbidden.join(', ')}`);
                    suggestedFix = `Clarify in terminology: do not mention "${forbidden.join(', ')}" when discussing ${testCase.expectedIntent}`;
                }
            }
        }

        const scores: JudgeScore = {
            intentRecognition: toolMatch ? 8 : 4,
            toolSelection: toolScore,
            argumentAccuracy: toolMatch ? 8 : 5,
            responseRelevance: Math.max(0, responseScore),
            noHallucination: 8,
        };

        const weightedScore =
            scores.intentRecognition * SCORE_WEIGHTS.intentRecognition +
            scores.toolSelection * SCORE_WEIGHTS.toolSelection +
            scores.argumentAccuracy * SCORE_WEIGHTS.argumentAccuracy +
            scores.responseRelevance * SCORE_WEIGHTS.responseRelevance +
            scores.noHallucination * SCORE_WEIGHTS.noHallucination;

        return {
            testCaseId: testCase.id,
            scores,
            weightedScore: Math.round(weightedScore * 100) / 100,
            passed: weightedScore >= 7.0,
            issues,
            suggestedFix,
            reasoning: 'Fallback rule-based evaluation (LLM judge unavailable)',
            toolsCalled: actualToolNames,
        };
    }

    /**
     * Evaluate multiple test results
     */
    async evaluateAll(
        testCases: TestCase[],
        results: LiveEvalResult[]
    ): Promise<JudgeResult[]> {
        const judgeResults: JudgeResult[] = [];

        const resultMap = new Map(results.map(r => [r.testCaseId, r]));

        for (const testCase of testCases) {
            const result = resultMap.get(testCase.id);
            if (!result) continue;

            console.log(`Judging: ${testCase.id}`);
            const judgeResult = await this.evaluate(testCase, result);
            judgeResults.push(judgeResult);

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        return judgeResults;
    }
}
