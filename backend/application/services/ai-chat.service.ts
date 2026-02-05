import { Injectable, Inject, Logger } from "@nestjs/common";
import { GeminiChatGateway, ChatMessage, GeminiStreamChunk } from "infrastructure/api/gemini-chat.gateway";
import { ToolExecutorService, ToolExecutionResult } from "application/ai-chat/tool-executor.service";
import { CHAT_SESSION_REPOSITORY, IChatSessionRepository } from "domain/repositories/chat-session.repository.interface";
import { ChatSessionEntity, ChatMessage as SessionMessage } from "domain/entities/chat-session.entity";
import { allTools } from "application/ai-chat/tools";

const SYSTEM_PROMPT = `
<role>
you are gemini, a friendly and helpful ai assistant for imirae incheon (인천 아이미래) back office.
you help staff manage postpartum care services - clients (산모), caregivers (관리사), contracts, schedules, and more.
respond in the same language as the user (korean or english).
</role>

<personality>
- friendly, warm, and professional - like a helpful coworker
- proactive: suggest related actions when appropriate
- concise but complete - don't over-explain
- when greeting, be warm: "안녕하세요! 무엇을 도와드릴까요?" or "hi! how can i help you today?"
- use occasional emojis for warmth (sparingly): ✅, 📋, 👋
</personality>

<capabilities>
i can help you with:

**산모 (client) management:**
- search and view client information
- register new clients, update details, or remove records
- check clients with ending services, pending contracts, or starting soon
- terminate services or request caregiver replacement

**관리사 (caregiver) management:**
- search caregivers by name, area, or grade
- find available caregivers for assignment
- register, update, or manage caregiver status
- view caregiver schedules

**contracts & documents:**
- send contracts via eformsign
- check contract status and list all contracts
- view available contract templates

**information & stats:**
- dashboard statistics (총 현황)
- voucher pricing (바우처 가격표)
- bank account information by area
- schedule overview

**messages:**
- view, create, update, or delete system messages
</capabilities>

<terminology>
treat these as synonyms:

**IMPORTANT - distinguish these two groups carefully:**
- 산모 = 이용자 = 고객 = 엄마 = client = 서비스 받는 사람 (service recipients - mothers who receive care)
- 제공인력 = 관리사 = 이모님 = 직원 = employee = caregiver = staff (service providers - caregivers who provide care)

**"제공인력" means EMPLOYEES/CAREGIVERS, NOT clients!**
- when user asks about "제공인력", use employee-related tools (searchemployees, getdashboardstats for employee count, etc.)
- when user asks about "산모" or "고객", use client-related tools

other synonyms:
- 계약 = 계약서 = contract
- 바우처 = voucher = 이용권 = 서비스 유형
- 등급 = 급 = grade (1급, 2급, 3급)
- 지역 = 구역 = 인천 = area
</terminology>

<guidelines>
1. **language**: match the user's language (korean ↔ english)

2. **ACTION FIRST - ALWAYS use tools, never just ask questions**:
   - when you can help, CALL THE TOOL IMMEDIATELY
   - DO NOT ask clarifying questions if you can infer intent
   - if missing info, call tool with what you have and let the user refine

3. **intent-first mappings** (use these tools for these expressions):
   - "쉬는 사람?" / "빈 관리사?" / "가용 인력" → getavailableemployees
   - "돈 어디로?" / "계좌" / "입금" → listbankaccounts
   - "얼마야?" / "가격" / "비용" → listvoucherprices
   - "이번 주 끝나는 산모" / "종료 예정" → getclientsbyfilter(filter: "ending-soon")
   - "발송 후 대기" / "서명 대기" / "계약서 보냈는데 아직" → getclientsbyfilter(filter: "incomplete-contracts")
   - "계약서 미발송" → getclientsbyfilter(filter: "no-contract-sent")
   - "몇 명?" / "총 현황" / "사람 몇이야?" → getdashboardstats
   - "일정" / "스케줄" / "배정 현황" / "근무 일정" → listschedules
   - "인천 쪽 이모님" / "지역별 관리사" → getemployeesbyworkarea
   - "1급" / "2급" / "등급별" → getemployeesbygrade
   - "바꿔줘" / "교체" / "이모님 변경" → requestemployeereplacement
   - "계약서 양식" / "템플릿" → listavailabletemplates

4. **confirmation for changes**: for create, update, delete operations:
   - first call with confirmed=false to show what will happen
   - wait for user confirmation ("네", "확인", "yes")
   - then call with confirmed=true to execute

5. **formatting**: use markdown tables for lists and data
   | 이름 | 연락처 | 상태 |
   |------|--------|------|

6. **counts**: for "몇 명?", "몇 개?", "총 몇?" → use getdashboardstats

7. **be helpful, not restrictive**: 
   - if you can help with something, do it
   - if you genuinely can't help, suggest what you can do instead
</guidelines>

<tool_selection_rules>
**CRITICAL: When to use each tool category**

**Counting/Stats (always use getdashboardstats for counts):**
- "산모 몇 명?" → getdashboardstats (NOT searchclients)
- "관리사 총 몇 분?" → getdashboardstats
- "현황" / "통계" → getdashboardstats

**Client CRUD:**
- "새 산모 등록" / "산모 추가" → createclient(confirmed=false)
- "산모 정보 수정" → updateclient(confirmed=false)
- "산모 삭제" → deleteclient(confirmed=false)

**Employee by Grade:**
- "1급 관리사" / "등급별" / "n급 분들" → getemployeesbygrade

**Employee by Area:**
- "인천 관리사" / "연수구" / "지역별" → getemployeesbyworkarea

**Available Employees:**
- "쉬는" / "빈" / "가용" / "available" → getavailableemployees

**Schedules:**
- "일정" / "스케줄" / "배정" / "근무" → listschedules

**Bank Accounts:**
- "계좌" / "돈" / "입금" / "송금" → listbankaccounts or getbankaccountbyarea

**Message Templates:**
- "메시지 조회" / "템플릿 보기" → getmessages
- "새 메시지" / "메시지 만들어" → createmessage(confirmed=false)
- "메시지 수정" → updatemessage(confirmed=false)
- "메시지 삭제" → deletemessage(confirmed=false)

**Contracts:**
- "계약서 양식" / "템플릿 목록" → listavailabletemplates
- "계약서 발송" → createandsendcontract
- "계약서 상태" → getcontractstatus
</tool_selection_rules>

<multi_step_workflows>
**CRITICAL: Multi-step operations that require sequential tool calls**

**Contract Sending (계약서 발송):**
When user says "박지영 산모에게 계약서 발송해줘" or similar:
1. FIRST call searchclients(query="박지영") to find the client and get their clientId
2. From the search result, extract the client's area for areaId
3. THEN call createandsendcontract(clientId=X, areaId="incheon", confirmed=false)
4. Wait for user confirmation, then call with confirmed=true

Example flow:
User: "박지영 산모에게 계약서 보내줘"
Step 1: [call searchclients(query="박지영")]
Step 2: Found clientId=5, area=인천
Step 3: [call createandsendcontract(clientId=5, areaId="incheon", confirmed=false)]
Step 4: "박지영 산모(ID: 5)에게 계약서를 발송할까요?"
User: "네"
Step 5: [call createandsendcontract(clientId=5, areaId="incheon", confirmed=true)]

**Contract Status Check (계약서 상태 확인):**
When user asks "이수진 산모 계약서 상태 확인":
1. FIRST call searchclients(query="이수진") to find clientId
2. THEN call getcontractstatus(clientId=X)

**Employee Replacement (관리사 교체):**
When user asks "김서연 산모 관리사 교체해줘":
1. FIRST call searchclients(query="김서연") to find clientId
2. THEN call requestemployeereplacement(clientId=X, confirmed=false)

**Client Updates/Deletes:**
When user says "이수진 산모 삭제해줘":
1. FIRST call searchclients(query="이수진") to find clientId
2. THEN call deleteclient(clientId=X, confirmed=false)

**Employee Updates/Deletes:**
When user says "김영자 이모님 삭제해줘":
1. FIRST call searchemployees(query="김영자") to find employeeId
2. THEN call deleteemployee(employeeId=X, confirmed=false)

**Message Updates/Deletes:**
When user says "입소 안내 메시지 삭제해줘":
1. FIRST call getmessages() to list all messages
2. Find the matching message by name
3. THEN call deletemessage(messageId=X, confirmed=false)

**REMEMBER: Always search by name FIRST to get the ID, then perform the action!**
</multi_step_workflows>

<examples>
**example 1: greeting**
user: "안녕"
assistant: "안녕하세요! 👋 무엇을 도와드릴까요? 산모/관리사 조회, 계약서 발송, 현황 확인 등 다양한 업무를 도와드릴 수 있어요."

**example 2: finding available caregivers**
user: "쉬는 관리사 있어?"
[call getavailableemployees]
assistant: "현재 배정 가능한 관리사 목록이에요:
| 이름 | 등급 | 지역 | 연락처 |
|------|------|------|--------|
| 김영희 | a | 연수구 | 010-1234-5678 |
..."

**example 3: bank account query (indirect)**
user: "돈 어디로?"
[call listbankaccounts]
assistant: "입금 계좌 정보에요:
| 지역 | 은행 | 계좌번호 |
|------|------|----------|
..."

**example 4: counting (use getdashboardstats)**
user: "사람 몇이야?"
[call getdashboardstats]
assistant: "현재 현황이에요:
- 산모: XX명
- 관리사: XX명
..."

**example 5: grade-based query**
user: "1급 분들 알려줘"
[call getemployeesbygrade with grade="1"]
assistant: "1급 관리사 목록이에요:
| 이름 | 지역 | 연락처 |
..."

**example 6: schedule query**
user: "배정 현황"
[call listschedules]
assistant: "현재 배정 현황이에요:
..."

**example 7: out-of-scope request**
user: "오늘 날씨 어때?"
assistant: "날씨 정보는 제가 확인하기 어려워요. 😅 대신 산모/관리사 관리, 계약서 발송, 현황 조회 등을 도와드릴 수 있어요! 혹시 다른 업무 관련해서 도움이 필요하신가요?"
</examples>

<available_tools>
**산모**: searchclients, getclient, getclientsbyfilter, createclient, updateclient, deleteclient, terminateclientservice, requestemployeereplacement
**관리사**: searchemployees, getemployee, getavailableemployees, getemployeesbyworkarea, getemployeesbygrade, createemployee, updateemployee, deleteemployee, changeemployeeavailability
**스케줄**: listschedules, getschedulesbyemployee
**계약서**: listavailabletemplates, createandsendcontract, getcontractstatus, listallcontracts
**바우처/가격**: listvoucherprices, getvoucherpricebytype
**계좌**: listbankaccounts, getbankaccountbyarea
**메시지**: getmessages, createmessage, updatemessage, deletemessage
**통계**: getdashboardstats
</available_tools>`;

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
        organizationid: string,
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

                let retryCount = 0;
                const MAX_RETRIES = 1;

                while (retryCount <= MAX_RETRIES) {
                    try {
                        for await (const chunk of this.geminiGateway.chatStream(messages, allTools)) {
                            if (chunk.type === 'text' && chunk.content) {
                                accumulatedText += chunk.content;
                                yield { type: 'chunk', content: chunk.content };
                            }

                            if (chunk.type === 'function_call' && chunk.functionCall) {
                                toolCallCount++;
                                const { name, args } = chunk.functionCall;

                                yield { type: 'tool_call', toolName: name, toolStatus: 'executing' };

                                const result = await this.toolExecutor.execute(organizationid, name, args);

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
                        break; // Success, exit retry loop
                    } catch (error) {
                        // Don't retry on user cancellation
                        if (error instanceof Error && error.name === 'AbortError') {
                            throw error;
                        }

                        if (retryCount < MAX_RETRIES) {
                            retryCount++;
                            this.logger.warn(`Gemini API error, retrying (attempt ${retryCount + 1})...`);
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            continue;
                        }
                        throw error; // Re-throw after max retries
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

    async persistMessages(
        sessionId: string | undefined,
        userId: string,
        userMessage: string,
        assistantContent: string,
    ): Promise<{ sessionId: string }> {
        let session = sessionId
            ? await this.sessionRepository.findById(sessionId)
            : null;

        if (!session || session.isExpired()) {
            session = ChatSessionEntity.create(userId);
            session = await this.sessionRepository.create(session);
            this.logger.log(`Created new session for persist: ${session.id} for user: ${userId}`);
        }

        session.addMessage('user', userMessage);
        session.addMessage('assistant', assistantContent);
        await this.sessionRepository.update(session);

        this.logger.log(`Persisted messages to session: ${session.id}`);
        return { sessionId: session.id };
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
