/**
 * AI Chat Evaluation Service
 * 
 * Evaluates AI chat responses against expected behaviors defined in test cases.
 * Uses mock-based testing for deterministic CI results.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface ResponseRules {
    mustInclude?: string[];
    mustNotInclude?: string[];
}

export interface TestCase {
    id: string;
    category: string;
    description: string;
    input: string;
    expectedIntent: string;
    expectedTools: string[];
    expectedArgs?: Record<string, unknown>;
    responseRules?: ResponseRules;
}

export interface EvalDataset {
    version: string;
    description: string;
    testCases: TestCase[];
}

export interface ToolCall {
    name: string;
    args: Record<string, unknown>;
}

export interface ChatResponse {
    text: string;
    toolCalls: ToolCall[];
}

export interface EvalResult {
    testCaseId: string;
    category: string;
    passed: boolean;
    scores: {
        toolSelection: number;
        responseRules: number;
        overall: number;
    };
    details: {
        expectedTools: string[];
        actualTools: string[];
        toolMatch: boolean;
        responseRuleViolations: string[];
    };
}

export interface EvalReport {
    timestamp: string;
    totalTests: number;
    passed: number;
    failed: number;
    passRate: number;
    byCategory: Record<string, { passed: number; total: number; passRate: number }>;
    results: EvalResult[];
}

export class ChatEvalService {
    private dataset: EvalDataset;

    constructor(datasetPath?: string) {
        const path = datasetPath || join(__dirname, 'eval-dataset.json');
        this.dataset = JSON.parse(readFileSync(path, 'utf-8'));
    }

    getTestCases(): TestCase[] {
        return this.dataset.testCases;
    }

    getTestCasesByCategory(category: string): TestCase[] {
        return this.dataset.testCases.filter(tc => tc.category === category);
    }

    /**
     * Evaluate a single test case against a chat response
     */
    evaluateTestCase(testCase: TestCase, response: ChatResponse): EvalResult {
        const actualToolNames = response.toolCalls.map(tc => tc.name.toLowerCase());
        const expectedToolNames = testCase.expectedTools.map(t => t.toLowerCase());

        // Check tool selection
        const toolMatch = this.checkToolMatch(expectedToolNames, actualToolNames);
        const toolScore = toolMatch ? 1.0 : this.calculateToolScore(expectedToolNames, actualToolNames);

        // Check response rules
        const ruleViolations = this.checkResponseRules(response.text, testCase.responseRules);
        const ruleScore = testCase.responseRules
            ? Math.max(0, 1 - (ruleViolations.length * 0.25))
            : 1.0;

        // Calculate overall score
        const overall = (toolScore * 0.6) + (ruleScore * 0.4);
        const passed = overall >= 0.8;

        return {
            testCaseId: testCase.id,
            category: testCase.category,
            passed,
            scores: {
                toolSelection: toolScore,
                responseRules: ruleScore,
                overall,
            },
            details: {
                expectedTools: testCase.expectedTools,
                actualTools: response.toolCalls.map(tc => tc.name),
                toolMatch,
                responseRuleViolations: ruleViolations,
            },
        };
    }

    /**
     * Check if expected tools match actual tools (order-independent)
     */
    private checkToolMatch(expected: string[], actual: string[]): boolean {
        if (expected.length === 0 && actual.length === 0) return true;
        if (expected.length === 0) return actual.length === 0;

        // At least one expected tool should be called
        return expected.some(exp => actual.includes(exp));
    }

    /**
     * Calculate partial tool matching score
     */
    private calculateToolScore(expected: string[], actual: string[]): number {
        if (expected.length === 0) {
            return actual.length === 0 ? 1.0 : 0.5;
        }

        const matches = expected.filter(exp => actual.includes(exp)).length;
        return matches / expected.length;
    }

    /**
     * Check response text against rules
     */
    private checkResponseRules(text: string, rules?: ResponseRules): string[] {
        const violations: string[] = [];
        if (!rules) return violations;

        const lowerText = text.toLowerCase();

        if (rules.mustInclude) {
            for (const term of rules.mustInclude) {
                if (!lowerText.includes(term.toLowerCase())) {
                    violations.push(`Missing required term: "${term}"`);
                }
            }
        }

        if (rules.mustNotInclude) {
            for (const term of rules.mustNotInclude) {
                if (lowerText.includes(term.toLowerCase())) {
                    violations.push(`Contains forbidden term: "${term}"`);
                }
            }
        }

        return violations;
    }

    /**
     * Generate evaluation report from results
     */
    generateReport(results: EvalResult[]): EvalReport {
        const passed = results.filter(r => r.passed).length;
        const byCategory: Record<string, { passed: number; total: number; passRate: number }> = {};

        for (const result of results) {
            if (!byCategory[result.category]) {
                byCategory[result.category] = { passed: 0, total: 0, passRate: 0 };
            }
            byCategory[result.category]!.total++;
            if (result.passed) {
                byCategory[result.category]!.passed++;
            }
        }

        for (const category of Object.keys(byCategory)) {
            const cat = byCategory[category]!;
            cat.passRate = cat.total > 0 ? (cat.passed / cat.total) * 100 : 0;
        }

        return {
            timestamp: new Date().toISOString(),
            totalTests: results.length,
            passed,
            failed: results.length - passed,
            passRate: results.length > 0 ? (passed / results.length) * 100 : 0,
            byCategory,
            results,
        };
    }
}
