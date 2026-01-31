import { Injectable, Inject, Logger } from "@nestjs/common";
import { GeminiChatGateway, ChatMessage, GeminiStreamChunk } from "infrastructure/api/gemini-chat.gateway";
import { ToolExecutorService, ToolExecutionResult } from "application/ai-chat/tool-executor.service";
import { CHAT_SESSION_REPOSITORY, IChatSessionRepository } from "domain/repositories/chat-session.repository.interface";
import { ChatSessionEntity, ChatMessage as SessionMessage } from "domain/entities/chat-session.entity";
import { allTools } from "application/ai-chat/tools";

const SYSTEM_PROMPT = `

Agent Persona:
- You are an AI assistant for Imirae Incheon back office AI assistant, gemini.
- 너는 인천 아이미래로 백오피스 시스템의 비서 Gemini AI야. (Respond in Korean if user asks in Korean, English if user asks in English)

CRITICAL RESTRICTIONS:
- You can ONLY use the provided tools/functions to answer questions
- DO NOT use any external knowledge, internet search, or general AI capabilities
- DO NOT answer questions unrelated to this care service system
- If a question cannot be answered using the available tools, respond: "죄송합니다. 해당 기능은 지원하지 않습니다. 산모/관리사 관리, 계약서 발송, 현황 조회 등의 기능만 사용 가능합니다."

INTENT-BASED TOOL SELECTION (CRITICAL):
- Focus on the USER'S INTENT, not exact phrase matching
- Even if user's wording is different, select the tool that matches their GOAL
- Ask clarifying questions ONLY if the intent is truly ambiguous
- Examples of intent mapping:
  * "누가 일 안해?" / "쉬는 사람?" / "놀고 있는 관리사" → getAvailableEmployees (looking for available staff)
  * "돈 어디로 보내?" / "입금 계좌" / "통장 번호" → listBankAccounts or getBankAccountByArea
  * "이번 주 끝나는 산모" / "퇴소 예정" / "종료 임박" → getClientsByFilter(filter: "ending-soon")
  * "계약서 발송 후 대기" / "발송 후 대기" / "서명 대기" / "계약서 보냈는데 아직" → getClientsByFilter(filter: "incomplete-contracts")
  * "가격 얼마야?" / "비용" / "요금" → listVoucherPrices or getVoucherPriceByType

DOMAIN TERMINOLOGY (treat these as synonyms):
- 산모 = 이용자 = 고객 = 엄마 = client = customer (service recipients - postpartum mothers)
- 제공인력 = 관리사 = 이모님 = 직원 = employee = caregiver = staff (service providers)
- 계약 = 계약서 = contract = agreement
- 바우처 = voucher = 이용권 = 서비스 유형

RULES:
1. Respond in the SAME LANGUAGE as the user (Korean or English)
2. For CREATE, UPDATE, DELETE operations: ALWAYS call the tool with confirmed=false first
3. When user confirms (says "yes", "확인", "네", etc.), call the tool again with confirmed=true
4. Be concise and professional
5. TABLE FORMATTING IS MANDATORY: Use Markdown tables whenever possible for lists, records, comparisons, search results, or any structured data. Ensure columns have clear headers (e.g., | Name | Phone | Status |).
6. When searching, show relevant details (name, phone, status)
7. For contract creation, always confirm client name and template before proceeding
8. When user asks "몇 명", "몇 개", "얼마나", use getDashboardStats for counts
9. NEVER provide information that doesn't come from the tools
10. DO NOT output any text before calling a tool - just call the tool directly
11. After getting tool results, format the response nicely without repeating what you're doing
12. If you must refuse, say it ONCE (no repeated sentences)

AVAILABLE OPERATIONS:
- 산모 검색/조회: searchClients, getClient, getClientsByFilter (계약서 미발송, 곧 시작/종료, 계약 미완료)
- 산모 등록/수정/삭제: createClient, updateClient, deleteClient
- 산모 서비스 관리: terminateClientService (서비스 종료), requestEmployeeReplacement (관리사 교체)
- 관리사 검색/조회: searchEmployees, getEmployee, getAvailableEmployees (배정 가능), getEmployeesByWorkArea (지역별), getEmployeesByGrade (등급별)
- 관리사 등록/수정/삭제: createEmployee, updateEmployee, deleteEmployee
- 관리사 상태 변경: changeEmployeeAvailability (배정 가능/불가 변경)
- 스케줄 조회: listSchedules (전체 스케줄), getSchedulesByEmployee (관리사별 스케줄)
- 계약서 관리: listAvailableTemplates, createAndSendContract, getContractStatus, listAllContracts (전체 계약서)
- 바우처 가격 조회: listVoucherPrices (가격표), getVoucherPriceByType (유형별 가격)
- 계좌 정보 조회: listBankAccounts (전체 계좌), getBankAccountByArea (지역별 계좌)
- 메시지 관리: getMessages, createMessage, updateMessage, deleteMessage
- 대시보드 통계: getDashboardStats (총 산모 수, 시작/종료 예정, 계약 현황)`;

const MAX_TOOL_CALLS_PER_TURN = 5;

export interface ChatStreamEvent {
    type: 'chunk' | 'tool_call' | 'confirmation' | 'done' | 'error';
    content?: string;
    toolName?: string;
    toolStatus?: string;
    confirmationMessage?: string;
    sessionId?: string;
    error?: string;
}

@Injectable()
export class AIChatService {
    private readonly logger = new Logger(AIChatService.name);

    constructor(
        private readonly geminiGateway: GeminiChatGateway,
        private readonly toolExecutor: ToolExecutorService,
        @Inject(CHAT_SESSION_REPOSITORY)
        private readonly sessionRepository: IChatSessionRepository,
    ) { }

    async *chatStream(
        sessionId: string | undefined,
        userId: string,
        userMessage: string,
    ): AsyncGenerator<ChatStreamEvent> {
        let session = sessionId
            ? await this.sessionRepository.findById(sessionId)
            : null;

        if (!session || session.isExpired()) {
            session = ChatSessionEntity.create(userId);
            session = await this.sessionRepository.create(session);
            this.logger.log(`Created new session: ${session.id} for user: ${userId}`);
        }

        session.addMessage('user', userMessage);

        const messages = this.buildGeminiMessages(session.messages);
        let toolCallCount = 0;

        try {
            let continueLoop = true;

            while (continueLoop && toolCallCount < MAX_TOOL_CALLS_PER_TURN) {
                continueLoop = false;
                let accumulatedText = '';

                for await (const chunk of this.geminiGateway.chatStream(messages, allTools)) {
                    if (chunk.type === 'text' && chunk.content) {
                        accumulatedText += chunk.content;
                        yield { type: 'chunk', content: chunk.content };
                    }

                    if (chunk.type === 'function_call' && chunk.functionCall) {
                        toolCallCount++;
                        const { name, args } = chunk.functionCall;

                        yield { type: 'tool_call', toolName: name, toolStatus: 'executing' };

                        const result = await this.toolExecutor.execute(name, args);

                        if (result.requiresConfirmation) {
                            yield {
                                type: 'confirmation',
                                confirmationMessage: result.confirmationMessage,
                            };

                            session.addMessage('assistant', result.confirmationMessage || '');
                            await this.sessionRepository.update(session);

                            yield { type: 'done', sessionId: session.id };
                            return;
                        }

                        messages.push({
                            role: 'model',
                            content: JSON.stringify({ functionCall: { name, args } }),
                        });
                        messages.push({
                            role: 'user',
                            content: JSON.stringify({ functionResponse: { name, response: result } }),
                        });

                        continueLoop = true;
                        break;
                    }

                    if (chunk.type === 'done') {
                        const text = accumulatedText.trim();
                        if (!text) {
                            continue;
                        }

                        const lastMessage = session.messages[session.messages.length - 1];
                        const isDuplicateAssistantMessage =
                            lastMessage?.role === 'assistant' && lastMessage.content === accumulatedText;

                        if (!isDuplicateAssistantMessage) {
                            session.addMessage('assistant', accumulatedText);
                        }
                    }

                    if (chunk.type === 'error') {
                        yield { type: 'error', error: chunk.error };
                        return;
                    }
                }
            }

            if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
                this.logger.warn(`Max tool calls reached for session ${session.id}`);
            }

            await this.sessionRepository.update(session);
            yield { type: 'done', sessionId: session.id };

        } catch (error) {
            this.logger.error(`Chat stream error: ${error}`);
            yield { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }

    async getSession(sessionId: string): Promise<ChatSessionEntity | null> {
        return this.sessionRepository.findById(sessionId);
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionRepository.delete(sessionId);
    }

    private buildGeminiMessages(sessionMessages: SessionMessage[]): ChatMessage[] {
        const messages: ChatMessage[] = [
            { role: 'system', content: SYSTEM_PROMPT },
        ];

        for (const msg of sessionMessages) {
            messages.push({
                role: msg.role === 'user' ? 'user' : 'model',
                content: msg.content,
            });
        }

        return messages;
    }
}
