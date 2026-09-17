/** Dispatch has committed. Refusal must never reopen an ordinary retry. */
export class AgentAutomationDispatchUncertainError extends Error {
    constructor() {
        super("문자 발송 승인 상태를 확인해야 합니다");
        this.name = "AgentAutomationDispatchUncertainError";
    }
}
