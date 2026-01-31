#!/usr/bin/env npx ts-node
/**
 * Self-Correcting AI Chat Evaluation CLI
 * 
 * Usage:
 *   npx ts-node test/ai-chat-eval/run-eval.ts
 *   npx ts-node test/ai-chat-eval/run-eval.ts --category=terminology
 *   npx ts-node test/ai-chat-eval/run-eval.ts --limit=10
 *   npx ts-node test/ai-chat-eval/run-eval.ts --dry-run
 */

import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from .env file
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match && match[1] && match[2]) {
            const key = match[1];
            const value = match[2].trim().replace(/^["']|["']$/g, '');
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    }
}

import { LiveEvalRunner } from './live-eval-runner.service';
import { LLMJudge, JudgeResult } from './llm-judge.service';
import { PromptImprover } from './prompt-improver.service';
import { QualityTracker } from './quality-tracker.service';

interface CLIOptions {
    category?: string;
    limit?: number;
    dryRun: boolean;
    verbose: boolean;
}

function parseArgs(): CLIOptions {
    const args = process.argv.slice(2);
    const options: CLIOptions = {
        dryRun: false,
        verbose: false,
    };

    for (const arg of args) {
        if (arg.startsWith('--category=')) {
            options.category = arg.split('=')[1];
        } else if (arg.startsWith('--limit=')) {
            const limitVal = arg.split('=')[1];
            options.limit = limitVal ? parseInt(limitVal, 10) : undefined;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        }
    }

    return options;
}

function formatScore(score: number): string {
    if (score >= 8) return `\x1b[32m${score.toFixed(1)}\x1b[0m`; // Green
    if (score >= 6) return `\x1b[33m${score.toFixed(1)}\x1b[0m`; // Yellow
    return `\x1b[31m${score.toFixed(1)}\x1b[0m`; // Red
}

function formatPassFail(passed: boolean): string {
    return passed
        ? '\x1b[32m✅ PASS\x1b[0m'
        : '\x1b[31m❌ FAIL\x1b[0m';
}

async function main(): Promise<void> {
    const options = parseArgs();

    console.log('\n🚀 \x1b[1mSelf-Correcting AI Chat Evaluation\x1b[0m\n');
    console.log('─'.repeat(50));

    if (!process.env['GEMINI_API_KEY']) {
        console.error('\x1b[31m❌ Error: GEMINI_API_KEY not found in environment\x1b[0m');
        console.log('Please set GEMINI_API_KEY in backend/.env file');
        process.exit(1);
    }

    // Initialize services
    const runner = new LiveEvalRunner();
    const judge = new LLMJudge();
    const improver = new PromptImprover();
    const tracker = new QualityTracker();

    console.log('📋 Initializing evaluation runner...');
    await runner.initialize();

    // Load test cases
    const testCases = runner.loadTestCases();
    let filteredCases = testCases;

    if (options.category) {
        filteredCases = testCases.filter(tc => tc.category === options.category);
        console.log(`📁 Category filter: ${options.category} (${filteredCases.length} tests)`);
    }

    if (options.limit) {
        filteredCases = filteredCases.slice(0, options.limit);
        console.log(`🔢 Limited to ${options.limit} tests`);
    }

    console.log(`\n📝 Running ${filteredCases.length} test cases...\n`);
    console.log('─'.repeat(50));

    if (options.dryRun) {
        console.log('\n\x1b[33m⚠️  DRY RUN MODE - No API calls will be made\x1b[0m\n');
        for (const tc of filteredCases) {
            console.log(`[${tc.id}] "${tc.input.substring(0, 40)}..."`);
            console.log(`   Expected: ${tc.expectedTools.join(', ') || '(no tools)'}`);
        }
        return;
    }

    // Run live evaluation
    const results = await runner.runAllTestCases({
        category: options.category,
        limit: options.limit
    });

    console.log('\n─'.repeat(50));
    console.log('\n🧑‍⚖️ Evaluating responses with LLM Judge...\n');

    // Judge all results
    const judgeResults = await judge.evaluateAll(filteredCases, results);

    // Display results
    console.log('\n─'.repeat(50));
    console.log('\n📊 \x1b[1mResults\x1b[0m\n');

    for (const jr of judgeResults) {
        const tc = filteredCases.find(t => t.id === jr.testCaseId);
        console.log(`[${jr.testCaseId}] ${formatPassFail(jr.passed)} (score: ${formatScore(jr.weightedScore)}/10)`);

        if (options.verbose || !jr.passed) {
            console.log(`   Input: "${tc?.input.substring(0, 50)}..."`);
            if (jr.issues.length > 0) {
                for (const issue of jr.issues) {
                    console.log(`   └── \x1b[33mIssue:\x1b[0m ${issue}`);
                }
            }
            if (jr.suggestedFix) {
                console.log(`   └── \x1b[36mSuggested fix:\x1b[0m ${jr.suggestedFix}`);
            }
        }
    }

    // Record and show stats
    const historyEntry = tracker.recordRun(judgeResults);
    const trend = tracker.getTrend();
    const recurring = tracker.getRecurringFailures();

    console.log('\n─'.repeat(50));
    console.log('\n📈 \x1b[1mSummary\x1b[0m\n');

    const passRate = historyEntry.passRate;
    const passColor = passRate >= 90 ? '\x1b[32m' : passRate >= 70 ? '\x1b[33m' : '\x1b[31m';

    console.log(`   Tests: ${historyEntry.passed}/${historyEntry.totalTests} passed (${passColor}${passRate.toFixed(1)}%\x1b[0m)`);
    console.log(`   Average Score: ${formatScore(historyEntry.averageScore)}/10`);
    console.log(`   ${trend.message}`);

    if (recurring.size > 0) {
        console.log(`\n   ⚠️  Recurring failures (failed 3+ times recently):`);
        for (const [testId, count] of recurring) {
            console.log(`      - ${testId}: failed ${count} times`);
        }
    }

    // Generate and save improvements
    const improvements = improver.generateImprovements(filteredCases, judgeResults);

    if (improvements.length > 0) {
        improver.writeImprovements(improvements);
        console.log(`\n   🔧 ${improvements.length} prompt improvements generated`);
        console.log(`   └── See: test/ai-chat-eval/prompt-improvements.md`);
    }

    // Append run history to markdown
    appendRunHistory(historyEntry, judgeResults, filteredCases);
    console.log(`   📝 Run history appended to prompt-improvements.md`);

    console.log('\n─'.repeat(50));
    console.log('\n✨ Done!\n');

    // Exit with error code if pass rate is too low
    if (passRate < 70) {
        console.log('\x1b[31m⚠️  Pass rate below 70% threshold\x1b[0m\n');
        process.exit(1);
    }
}

/**
 * Append run history to prompt-improvements.md for review
 */
function appendRunHistory(
    entry: { timestamp: string; totalTests: number; passed: number; failed: number; passRate: number; averageScore: number },
    judgeResults: JudgeResult[],
    testCases: { id: string; input: string; expectedTools?: string[]; expectedIntent?: string }[]
): void {
    const mdPath = path.join(__dirname, 'prompt-improvements.md');

    const date = new Date(entry.timestamp);
    const formattedDate = date.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });

    const failedTests = judgeResults.filter(jr => !jr.passed);

    // Build run entry
    let runEntry = `\n\n---\n\n### Run ${formattedDate}\n\n`;
    runEntry += `| Metric | Value |\n`;
    runEntry += `|--------|-------|\n`;
    runEntry += `| **Pass Rate** | ${entry.passRate.toFixed(1)}% (${entry.passed}/${entry.totalTests}) |\n`;
    runEntry += `| **Avg Score** | ${entry.averageScore.toFixed(1)}/10 |\n`;
    runEntry += `| **Passed** | ${entry.passed} |\n`;
    runEntry += `| **Failed** | ${entry.failed} |\n`;

    if (failedTests.length > 0) {
        runEntry += `\n#### ❌ Failed Tests\n\n`;

        for (const ft of failedTests.slice(0, 15)) { // Limit to 15 for brevity
            const tc = testCases.find(t => t.id === ft.testCaseId);
            const inputPreview = tc?.input || '';
            const expectedTools = tc?.expectedTools?.join(', ') || '(none)';
            const actualTools = ft.toolsCalled?.join(', ') || '(none)';

            runEntry += `**\`${ft.testCaseId}\`** (score: ${ft.weightedScore.toFixed(1)}/10)\n`;
            runEntry += `- **Input**: "${inputPreview}"\n`;
            runEntry += `- **Expected Tool**: \`${expectedTools}\`\n`;
            runEntry += `- **Actual Tool**: \`${actualTools}\`\n`;

            // Add issues
            if (ft.issues && ft.issues.length > 0) {
                runEntry += `- **Issues**:\n`;
                for (const issue of ft.issues.slice(0, 3)) { // Limit to 3 issues
                    runEntry += `  - ${issue}\n`;
                }
            }

            // Add suggested fix
            if (ft.suggestedFix) {
                runEntry += `- **Fix**: ${ft.suggestedFix}\n`;
            }

            runEntry += `\n`;
        }

        if (failedTests.length > 15) {
            runEntry += `... and ${failedTests.length - 15} more failures\n`;
        }
    }

    // Append to file
    if (fs.existsSync(mdPath)) {
        fs.appendFileSync(mdPath, runEntry);
    } else {
        // Create file with header if it doesn't exist
        const header = `# Prompt Improvements & Run History\n\n> Auto-generated evaluation results\n`;
        fs.writeFileSync(mdPath, header + runEntry);
    }
}

main().catch(err => {
    console.error('\x1b[31mEvaluation failed:\x1b[0m', err);
    process.exit(1);
});
