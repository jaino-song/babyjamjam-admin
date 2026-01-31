/// <reference types="jest" />
/**
 * AI Chat Evaluation Test Runner
 * 
 * Jest-based test runner for evaluating AI chat quality.
 * Uses mock responses to test tool selection logic.
 * 
 * Run with: npm test -- --testPathPattern=chat-eval
 */

import { ChatEvalService, TestCase, ChatResponse, EvalResult } from './chat-eval.service';
import { allTools } from '../../application/ai-chat/tools';

describe('AI Chat Evaluation Suite', () => {
    let evalService: ChatEvalService;

    beforeAll(() => {
        evalService = new ChatEvalService();
    });

    describe('Tool Definitions', () => {
        it('should have all expected tools defined', () => {
            const toolNames = allTools.map(t => t.name.toLowerCase());
            const expectedTools = [
                'searchclients',
                'searchemployees',
                'getdashboardstats',
                'getclientsbyfilter',
                'getavailableemployees',
                'listbankaccounts',
            ];

            for (const expected of expectedTools) {
                expect(toolNames).toContain(expected);
            }
        });
    });

    describe('Terminology Recognition', () => {
        let terminologyTests: TestCase[];

        beforeAll(() => {
            terminologyTests = evalService.getTestCasesByCategory('terminology');
        });

        it('should have terminology test cases loaded', () => {
            expect(terminologyTests.length).toBeGreaterThan(0);
        });

        describe('제공인력 terminology', () => {
            it('제공인력 tool description should map to employees', () => {
                const employeeTools = allTools.filter(t =>
                    t.name.toLowerCase().includes('employee')
                );

                const hasTermMapping = employeeTools.some(tool =>
                    tool.description?.includes('제공인력')
                );

                expect(hasTermMapping).toBe(true);
            });

            it('getdashboardstats should be suitable for counting 제공인력', () => {
                const dashboardTool = allTools.find(t =>
                    t.name.toLowerCase() === 'getdashboardstats'
                );

                expect(dashboardTool).toBeDefined();
            });
        });

        describe('산모 terminology', () => {
            it('client tools should reference 산모', () => {
                const clientTools = allTools.filter(t =>
                    t.name.toLowerCase().includes('client')
                );

                const hasTermMapping = clientTools.some(tool =>
                    tool.description?.includes('산모')
                );

                expect(hasTermMapping).toBe(true);
            });
        });
    });

    describe('Tool Selection Validation', () => {
        const mockResponses: Record<string, ChatResponse> = {
            'term-001': {
                text: '현재 총 4명의 직원이 등록되어 있습니다.',
                toolCalls: [{ name: 'getdashboardstats', args: {} }],
            },
            'term-004': {
                text: '현재 총 10명의 산모가 등록되어 있어요.',
                toolCalls: [{ name: 'getdashboardstats', args: {} }],
            },
            'intent-001': {
                text: '현재 배정 가능한 관리사 목록입니다.',
                toolCalls: [{ name: 'getavailableemployees', args: {} }],
            },
            'intent-004': {
                text: '계약서 발송 후 서명 대기 중인 고객들입니다.',
                toolCalls: [{ name: 'getclientsbyfilter', args: { filter: 'incomplete-contracts' } }],
            },
            'indirect-001': {
                text: '현재 배정 가능한 관리사 목록입니다.',
                toolCalls: [{ name: 'getavailableemployees', args: {} }],
            },
            'client-010': {
                text: '계약서 발송 후 서명 대기 중인 고객들입니다.',
                toolCalls: [{ name: 'getclientsbyfilter', args: { filter: 'incomplete-contracts' } }],
            },
        };

        it('should correctly evaluate 제공인력 count request', () => {
            const testCase = evalService.getTestCases().find(tc => tc.id === 'term-001');
            expect(testCase).toBeDefined();

            const response = mockResponses['term-001']!;
            const result = evalService.evaluateTestCase(testCase!, response);

            expect(result.details.toolMatch).toBe(true);
            expect(result.scores.toolSelection).toBe(1.0);
        });

        it('should correctly evaluate 산모 count request', () => {
            const testCase = evalService.getTestCases().find(tc => tc.id === 'term-004');
            expect(testCase).toBeDefined();

            const response = mockResponses['term-004']!;
            const result = evalService.evaluateTestCase(testCase!, response);

            expect(result.details.toolMatch).toBe(true);
        });

        it('should correctly evaluate available employees request', () => {
            const testCase = evalService.getTestCases().find(tc => tc.id === 'indirect-001');
            expect(testCase).toBeDefined();

            const response = mockResponses['indirect-001']!;
            const result = evalService.evaluateTestCase(testCase!, response);

            expect(result.details.toolMatch).toBe(true);
        });

        it('should correctly evaluate incomplete contracts filter', () => {
            const testCase = evalService.getTestCases().find(tc => tc.id === 'client-010');
            expect(testCase).toBeDefined();

            const response = mockResponses['client-010']!;
            const result = evalService.evaluateTestCase(testCase!, response);

            expect(result.details.toolMatch).toBe(true);
        });
    });

    describe('Response Rule Validation', () => {
        it('should detect forbidden terms in response', () => {
            const testCase = evalService.getTestCases().find(tc => tc.id === 'term-001');
            expect(testCase).toBeDefined();

            // Simulate incorrect response that mentions 산모 when asked about 제공인력
            const badResponse: ChatResponse = {
                text: '현재 총 4명의 산모가 등록되어 있습니다.',
                toolCalls: [{ name: 'getdashboardstats', args: {} }],
            };

            const result = evalService.evaluateTestCase(testCase!, badResponse);

            expect(result.details.responseRuleViolations.length).toBeGreaterThan(0);
            expect(result.details.responseRuleViolations.some(v => v.includes('산모'))).toBe(true);
        });

        it('should detect missing required terms in response', () => {
            const testCase = evalService.getTestCases().find(tc => tc.id === 'conv-001');
            expect(testCase).toBeDefined();

            const badResponse: ChatResponse = {
                text: 'Hello there!',
                toolCalls: [],
            };

            const result = evalService.evaluateTestCase(testCase!, badResponse);

            expect(result.details.responseRuleViolations.length).toBeGreaterThan(0);
        });
    });

    describe('Report Generation', () => {
        it('should generate valid evaluation report', () => {
            const mockResults: EvalResult[] = [
                {
                    testCaseId: 'term-001',
                    category: 'terminology',
                    passed: true,
                    scores: { toolSelection: 1.0, responseRules: 1.0, overall: 1.0 },
                    details: { expectedTools: ['getdashboardstats'], actualTools: ['getdashboardstats'], toolMatch: true, responseRuleViolations: [] },
                },
                {
                    testCaseId: 'term-002',
                    category: 'terminology',
                    passed: false,
                    scores: { toolSelection: 0.5, responseRules: 0.75, overall: 0.6 },
                    details: { expectedTools: ['getdashboardstats'], actualTools: [], toolMatch: false, responseRuleViolations: ['Missing required term'] },
                },
            ];

            const report = evalService.generateReport(mockResults);

            expect(report.totalTests).toBe(2);
            expect(report.passed).toBe(1);
            expect(report.failed).toBe(1);
            expect(report.passRate).toBe(50);
            expect(report.byCategory['terminology']!.total).toBe(2);
            expect(report.byCategory['terminology']!.passed).toBe(1);
        });
    });
});
