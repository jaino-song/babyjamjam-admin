import * as fs from 'fs';
import * as path from 'path';
import { JudgeResult } from './llm-judge.service';
import { TestCase } from './live-eval-runner.service';

export interface PromptImprovement {
    category: 'synonym' | 'intent_example' | 'disambiguation' | 'tool_guidance' | 'response_rule';
    severity: 'critical' | 'high' | 'medium' | 'low';
    failedTestIds: string[];
    failureCount: number;
    suggestion: string;
    impact: string;
}

interface FailurePattern {
    category: string;
    testIds: string[];
    issues: string[];
    suggestions: string[];
}

/**
 * PromptImprover - Auto-generates prompt improvements based on test failures
 * 
 * Analyzes failure patterns and generates specific, actionable improvements
 * for the system prompt.
 */
export class PromptImprover {
    private readonly outputPath: string;

    constructor() {
        this.outputPath = path.resolve(__dirname, './prompt-improvements.md');
    }

    /**
     * Analyze judge results and generate improvement suggestions
     */
    generateImprovements(
        testCases: TestCase[],
        judgeResults: JudgeResult[]
    ): PromptImprovement[] {
        const failures = judgeResults.filter(r => !r.passed);

        if (failures.length === 0) {
            return [];
        }

        const testCaseMap = new Map(testCases.map(tc => [tc.id, tc]));

        // Group failures by pattern
        const patterns = this.identifyPatterns(failures, testCaseMap);

        // Generate specific improvements for each pattern
        const improvements: PromptImprovement[] = [];

        for (const pattern of patterns) {
            const improvement = this.patternToImprovement(pattern);
            if (improvement) {
                improvements.push(improvement);
            }
        }

        // Sort by severity and failure count
        improvements.sort((a, b) => {
            const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
            if (severityOrder[a.severity] !== severityOrder[b.severity]) {
                return severityOrder[a.severity] - severityOrder[b.severity];
            }
            return b.failureCount - a.failureCount;
        });

        return improvements;
    }

    private identifyPatterns(
        failures: JudgeResult[],
        testCaseMap: Map<string, TestCase>
    ): FailurePattern[] {
        const patternGroups = new Map<string, FailurePattern>();

        for (const failure of failures) {
            const testCase = testCaseMap.get(failure.testCaseId);
            if (!testCase) continue;

            const category = testCase.category;

            if (!patternGroups.has(category)) {
                patternGroups.set(category, {
                    category,
                    testIds: [],
                    issues: [],
                    suggestions: [],
                });
            }

            const pattern = patternGroups.get(category)!;
            pattern.testIds.push(failure.testCaseId);
            pattern.issues.push(...failure.issues);
            if (failure.suggestedFix) {
                pattern.suggestions.push(failure.suggestedFix);
            }
        }

        return Array.from(patternGroups.values());
    }

    private patternToImprovement(pattern: FailurePattern): PromptImprovement | null {
        const failureCount = pattern.testIds.length;

        // Determine severity based on category and failure count
        let severity: PromptImprovement['severity'] = 'low';
        if (pattern.category === 'terminology') {
            severity = 'critical'; // Terminology confusion is always critical
        } else if (failureCount >= 5) {
            severity = 'critical';
        } else if (failureCount >= 3) {
            severity = 'high';
        } else if (failureCount >= 2) {
            severity = 'medium';
        }

        // Determine improvement category
        let improvementCategory: PromptImprovement['category'] = 'tool_guidance';
        if (pattern.category === 'terminology') {
            improvementCategory = 'disambiguation';
        } else if (pattern.category === 'indirect') {
            improvementCategory = 'intent_example';
        } else if (pattern.issues.some(i => i.includes('synonym'))) {
            improvementCategory = 'synonym';
        }

        // Generate specific suggestion
        const suggestion = this.generateSuggestion(pattern);
        const impact = this.estimateImpact(pattern);

        return {
            category: improvementCategory,
            severity,
            failedTestIds: pattern.testIds,
            failureCount,
            suggestion,
            impact,
        };
    }

    private generateSuggestion(pattern: FailurePattern): string {
        // Use the most common suggestion from LLM judge, or generate one
        if (pattern.suggestions.length > 0) {
            // Find most common suggestion
            const suggestionCounts = new Map<string, number>();
            for (const s of pattern.suggestions) {
                suggestionCounts.set(s, (suggestionCounts.get(s) || 0) + 1);
            }
            const sorted = Array.from(suggestionCounts.entries()).sort((a, b) => b[1] - a[1]);
            if (sorted.length > 0 && sorted[0]) {
                return sorted[0][0];
            }
        }

        // Generate based on category
        switch (pattern.category) {
            case 'terminology':
                return 'Add explicit terminology mapping in <terminology> section. Ensure 제공인력/관리사/이모님 → employees is clearly stated.';
            case 'indirect':
                return `Add example query mappings in <guidelines> section for informal/colloquial expressions.`;
            case 'client':
                return 'Add more client-related intent examples in <examples> section.';
            case 'employee':
                return 'Add more employee-related intent examples in <examples> section.';
            default:
                return `Review ${pattern.category} tool descriptions and add usage examples.`;
        }
    }

    private estimateImpact(pattern: FailurePattern): string {
        const failureCount = pattern.testIds.length;
        if (failureCount >= 5) {
            return `High impact: Fixing this will resolve ${failureCount} test failures`;
        } else if (failureCount >= 3) {
            return `Medium impact: Will fix ${failureCount} test cases`;
        } else {
            return `Low impact: Will fix ${failureCount} test case(s)`;
        }
    }

    /**
     * Write improvements to markdown file
     */
    writeImprovements(improvements: PromptImprovement[]): void {
        const timestamp = new Date().toISOString();

        let content = `# Prompt Improvements (Auto-Generated)

> **Last Updated**: ${timestamp}
> **Total Suggestions**: ${improvements.length}

---

`;

        // Group by severity
        const bySeverity = {
            critical: improvements.filter(i => i.severity === 'critical'),
            high: improvements.filter(i => i.severity === 'high'),
            medium: improvements.filter(i => i.severity === 'medium'),
            low: improvements.filter(i => i.severity === 'low'),
        };

        if (bySeverity.critical.length > 0) {
            content += `## 🔴 Critical (${bySeverity.critical.length})\n\n`;
            for (const imp of bySeverity.critical) {
                content += this.formatImprovement(imp);
            }
        }

        if (bySeverity.high.length > 0) {
            content += `## 🟠 High (${bySeverity.high.length})\n\n`;
            for (const imp of bySeverity.high) {
                content += this.formatImprovement(imp);
            }
        }

        if (bySeverity.medium.length > 0) {
            content += `## 🟡 Medium (${bySeverity.medium.length})\n\n`;
            for (const imp of bySeverity.medium) {
                content += this.formatImprovement(imp);
            }
        }

        if (bySeverity.low.length > 0) {
            content += `## 🟢 Low (${bySeverity.low.length})\n\n`;
            for (const imp of bySeverity.low) {
                content += this.formatImprovement(imp);
            }
        }

        if (improvements.length === 0) {
            content += `✅ **All tests passed!** No improvements needed.\n`;
        }

        fs.writeFileSync(this.outputPath, content, 'utf-8');
    }

    private formatImprovement(imp: PromptImprovement): string {
        return `### ${imp.category.replace(/_/g, ' ').toUpperCase()}

- [ ] **Suggestion**: ${imp.suggestion}
- **Failed Tests**: ${imp.failedTestIds.join(', ')}
- **Impact**: ${imp.impact}

---

`;
    }
}
