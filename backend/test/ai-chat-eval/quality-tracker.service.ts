import * as fs from 'fs';
import * as path from 'path';
import { JudgeResult } from './llm-judge.service';

export interface EvalHistoryEntry {
    timestamp: string;
    totalTests: number;
    passed: number;
    failed: number;
    passRate: number;
    averageScore: number;
    failedTestIds: string[];
}

export interface QualityTrend {
    direction: 'improving' | 'stable' | 'declining';
    changePercent: number;
    message: string;
}

/**
 * QualityTracker - Tracks evaluation quality over time
 * 
 * Stores historical results and identifies trends:
 * - Pass rate over time
 * - Recurring failures
 * - Quality improvements/regressions
 */
export class QualityTracker {
    private readonly historyPath: string;
    private history: EvalHistoryEntry[] = [];

    constructor() {
        this.historyPath = path.resolve(__dirname, './eval-history.json');
        this.loadHistory();
    }

    private loadHistory(): void {
        try {
            if (fs.existsSync(this.historyPath)) {
                const content = fs.readFileSync(this.historyPath, 'utf-8');
                this.history = JSON.parse(content);
            }
        } catch {
            this.history = [];
        }
    }

    private saveHistory(): void {
        fs.writeFileSync(this.historyPath, JSON.stringify(this.history, null, 2), 'utf-8');
    }

    /**
     * Record a new evaluation run
     */
    recordRun(judgeResults: JudgeResult[]): EvalHistoryEntry {
        const totalTests = judgeResults.length;
        const passed = judgeResults.filter(r => r.passed).length;
        const failed = totalTests - passed;
        const passRate = totalTests > 0 ? (passed / totalTests) * 100 : 0;
        const averageScore = totalTests > 0
            ? judgeResults.reduce((sum, r) => sum + r.weightedScore, 0) / totalTests
            : 0;

        const entry: EvalHistoryEntry = {
            timestamp: new Date().toISOString(),
            totalTests,
            passed,
            failed,
            passRate: Math.round(passRate * 100) / 100,
            averageScore: Math.round(averageScore * 100) / 100,
            failedTestIds: judgeResults.filter(r => !r.passed).map(r => r.testCaseId),
        };

        this.history.push(entry);

        // Keep only last 100 entries
        if (this.history.length > 100) {
            this.history = this.history.slice(-100);
        }

        this.saveHistory();
        return entry;
    }

    /**
     * Calculate quality trend
     */
    getTrend(): QualityTrend {
        if (this.history.length < 2) {
            return {
                direction: 'stable',
                changePercent: 0,
                message: 'Not enough history to determine trend',
            };
        }

        const recent = this.history.slice(-5);
        const recentAvg = recent.reduce((sum, e) => sum + e.passRate, 0) / recent.length;

        const previous = this.history.slice(-10, -5);
        if (previous.length === 0) {
            return {
                direction: 'stable',
                changePercent: 0,
                message: 'Not enough history to determine trend',
            };
        }
        const previousAvg = previous.reduce((sum, e) => sum + e.passRate, 0) / previous.length;

        const change = recentAvg - previousAvg;
        const changePercent = Math.round(change * 100) / 100;

        let direction: QualityTrend['direction'];
        let message: string;

        if (change > 2) {
            direction = 'improving';
            message = `📈 Quality improving: +${changePercent}% pass rate`;
        } else if (change < -2) {
            direction = 'declining';
            message = `📉 Quality declining: ${changePercent}% pass rate`;
        } else {
            direction = 'stable';
            message = `📊 Quality stable at ${Math.round(recentAvg)}% pass rate`;
        }

        return { direction, changePercent, message };
    }

    /**
     * Get recurring failures (tests that failed in multiple recent runs)
     */
    getRecurringFailures(): Map<string, number> {
        const failureCounts = new Map<string, number>();

        const recentRuns = this.history.slice(-10);
        for (const run of recentRuns) {
            for (const testId of run.failedTestIds) {
                failureCounts.set(testId, (failureCounts.get(testId) || 0) + 1);
            }
        }

        // Return only tests that failed 3+ times
        const recurring = new Map<string, number>();
        for (const [testId, count] of failureCounts) {
            if (count >= 3) {
                recurring.set(testId, count);
            }
        }

        return recurring;
    }

    /**
     * Get latest entry
     */
    getLatest(): EvalHistoryEntry | null {
        if (this.history.length === 0) {
            return null;
        }
        return this.history[this.history.length - 1] ?? null;
    }

    /**
     * Get all history
     */
    getHistory(): EvalHistoryEntry[] {
        return [...this.history];
    }
}
