# Prompt Improvements (Auto-Generated)

> **Last Updated**: 2026-01-30T18:36:24.175Z
> **Total Suggestions**: 6

---

## 🔴 Critical (3)

### INTENT EXAMPLE

- [ ] **Suggestion**: When the user asks about bank accounts, the prompt should instruct the AI to call the 'listbankaccounts' tool immediately, and then ask for the area if needed.
- **Failed Tests**: indirect-002, indirect-003, indirect-004, indirect-005, indirect-007, indirect-009, indirect-012, indirect-014, indirect-016, indirect-019
- **Impact**: High impact: Fixing this will resolve 10 test failures

---

### TOOL GUIDANCE

- [ ] **Suggestion**: Ensure the AI correctly identifies the need to call the 'getavailableemployees' tool when the user asks about available employees.
- **Failed Tests**: employee-003, employee-005, employee-006, employee-007, employee-008, employee-009, employee-010
- **Impact**: High impact: Fixing this will resolve 7 test failures

---

### DISAMBIGUATION

- [ ] **Suggestion**: Ensure the AI correctly identifies the need to call 'getdashboardstats' when the user asks about the number of employees.
- **Failed Tests**: term-001, term-006, term-008
- **Impact**: Medium impact: Will fix 3 test cases

---

## 🟠 High (2)

### TOOL GUIDANCE

- [ ] **Suggestion**: The prompt should be updated to ensure the AI attempts to use the 'updateclient' tool, even if the specific functionality (phone number update) is not available. The AI should attempt to use the tool and then provide a more informative response about the limitations.
- **Failed Tests**: client-005, client-006, client-012
- **Impact**: Medium impact: Will fix 3 test cases

---

### TOOL GUIDANCE

- [ ] **Suggestion**: The prompt should explicitly instruct the AI to use the 'createmessage' tool when the user requests a new message template.
- **Failed Tests**: message-002, message-003, message-004
- **Impact**: Medium impact: Will fix 3 test cases

---

## 🟢 Low (1)

### TOOL GUIDANCE

- [ ] **Suggestion**: Improve the prompt to explicitly instruct the AI to list available contract templates when the user asks for them. Consider adding examples of user queries and expected tool calls in the prompt.
- **Failed Tests**: contract-002
- **Impact**: Low impact: Will fix 1 test case(s)

---



---

### Run 2026. 01. 31. 오전 03:36

| Metric | Value |
|--------|-------|
| **Pass Rate** | 64.9% (50/77) |
| **Avg Score** | 7.9/10 |
| **Passed** | 50 |
| **Failed** | 27 |

#### ❌ Failed Tests

**`term-001`** (score: 4.0/10)
- **Input**: "현재 등록된 제공인력은 몇명이야?"
- **Expected Tool**: `getdashboardstats`
- **Actual Tool**: `(none)`
- **Issues**:
  - The AI failed to call the required tool 'getdashboardstats'.
  - The response is just a placeholder and does not answer the question.
- **Fix**: Ensure the AI correctly identifies the need to call 'getdashboardstats' when the user asks about the number of employees.

**`term-006`** (score: 4.0/10)
- **Input**: "고객 수 알려줘"
- **Expected Tool**: `getdashboardstats`
- **Actual Tool**: `(none)`
- **Issues**:
  - The AI failed to call the required tool.
  - The response is not helpful.
- **Fix**: Ensure the AI correctly identifies the need for the 'getdashboardstats' tool when the user asks for the number of clients.

**`term-008`** (score: 5.0/10)
- **Input**: "우리 엄마들 몇 분이야?"
- **Expected Tool**: `getdashboardstats`
- **Actual Tool**: `(none)`
- **Issues**:
  - The AI failed to call any tools.
  - The AI should have called the getdashboardstats tool.
- **Fix**: Improve the prompt to explicitly instruct the AI to use the getdashboardstats tool when the user asks about the number of clients.

**`client-005`** (score: 4.6/10)
- **Input**: "이수진 산모 전화번호 변경해줘"
- **Expected Tool**: `updateclient`
- **Actual Tool**: `(none)`
- **Issues**:
  - Failed to call the required 'updateclient' tool.
  - The response acknowledges the user's request but doesn't attempt to fulfill it, instead stating the feature is unsupported.
- **Fix**: The prompt should be updated to ensure the AI attempts to use the 'updateclient' tool, even if the specific functionality (phone number update) is not available. The AI should attempt to use the tool and then provide a more informative response about the limitations.

**`client-006`** (score: 5.2/10)
- **Input**: "최민지 산모 삭제해줘"
- **Expected Tool**: `deleteclient`
- **Actual Tool**: `searchclients`
- **Issues**:
  - Incorrect intent recognition. The user requested deletion, but the AI performed a search.
  - Incorrect tool selection. The AI should have called 'deleteClient' instead of 'searchClients'.
  - The response is empty, failing to address the user's request.
- **Fix**: Improve the prompt to explicitly instruct the AI to use the 'deleteClient' tool when the user requests to delete a client.

**`client-012`** (score: 5.2/10)
- **Input**: "김서연 산모 관리사 교체해줘"
- **Expected Tool**: `requestemployeereplacement`
- **Actual Tool**: `searchclients`
- **Issues**:
  - Incorrect intent recognition: The user wants to replace an employee, not search for a client.
  - Incorrect tool selection: The AI called `searchClients` instead of `requestemployeereplacement`.
  - Response is empty and does not address the user's request.
- **Fix**: Improve the prompt to explicitly mention the need for employee replacement and the target client. For example: '김서연 산모의 관리사를 교체해줘' should trigger the `requestemployeereplacement` tool.

**`employee-003`** (score: 4.0/10)
- **Input**: "배정 가능한 관리사"
- **Expected Tool**: `getavailableemployees`
- **Actual Tool**: `(none)`
- **Issues**:
  - The AI failed to call the getavailableemployees tool.
  - The response is just the tool name in brackets, which is not helpful.
- **Fix**: Ensure the AI correctly identifies the need to call the 'getavailableemployees' tool when the user asks about available employees.

**`employee-005`** (score: 4.6/10)
- **Input**: "A등급 이모님들"
- **Expected Tool**: `getemployeesbygrade`
- **Actual Tool**: `(none)`
- **Issues**:
  - Failed to call the required tool.
  - The response is a question, not an answer.
- **Fix**: The prompt should explicitly instruct the AI to call the appropriate tool (getemployeesbygrade) when the user asks for employees of a certain grade. The prompt should also specify that the AI should provide the information directly, not ask a clarifying question.

**`employee-006`** (score: 5.0/10)
- **Input**: "새 관리사 등록해줘"
- **Expected Tool**: `createemployee`
- **Actual Tool**: `(none)`
- **Issues**:
  - Failed to call the required tool.
  - The response is a conversational prompt and not a direct action.
- **Fix**: The prompt should explicitly instruct the AI to call the 'createemployee' tool when the user requests to register a new caregiver. The response should be a confirmation of the tool call, not a conversational prompt.

**`employee-007`** (score: 4.5/10)
- **Input**: "김영자 이모님 전화번호 수정"
- **Expected Tool**: `updateemployee`
- **Actual Tool**: `(none)`
- **Issues**:
  - Incorrect tool selection. The AI should have called the `updateemployee` tool.
  - The response is not helpful because it does not provide a way to fulfill the user's request.
- **Fix**: The prompt should be updated to explicitly instruct the AI to use the `updateemployee` tool when the user requests to modify employee information.

**`employee-008`** (score: 4.8/10)
- **Input**: "박순자 이모님 삭제해줘"
- **Expected Tool**: `deleteemployee`
- **Actual Tool**: `searchemployees`
- **Issues**:
  - Incorrect intent: The AI should have recognized the intent to delete an employee.
  - Incorrect tool: The AI called 'searchemployees' instead of 'deleteemployee'.
  - Response is empty and does not address the user's request.
- **Fix**: Improve the prompt to explicitly instruct the AI to use the 'deleteemployee' tool when the user requests to delete an employee. Also, include examples of user inputs and expected tool calls in the prompt.

**`employee-009`** (score: 3.9/10)
- **Input**: "이정희 관리사 배정 가능으로 변경"
- **Expected Tool**: `changeemployeeavailability`
- **Actual Tool**: `(none)`
- **Issues**:
  - Incorrect intent. The user wants to change the availability of an employee.
  - No tool was called when the `changeemployeeavailability` tool should have been called.
  - The response is not directly addressing the user's request to change availability.
- **Fix**: Improve the prompt to explicitly state the need to change the employee's availability and to call the `changeemployeeavailability` tool. For example: 'Change the availability of 이정희 관리사 to available.'

**`employee-010`** (score: 6.1/10)
- **Input**: "최영순 이모님 휴무 처리해줘"
- **Expected Tool**: `changeemployeeavailability`
- **Actual Tool**: `searchemployees`
- **Issues**:
  - Incorrect tool selected. The user wants to change the employee's availability, but the tool called was searchemployees.
  - The response is empty, indicating the tool did not perform the intended action.
- **Fix**: The prompt should be updated to include the correct tool for changing employee availability, such as 'changeemployeeavailability'. The prompt should also include the date or period for the unavailability.

**`contract-002`** (score: 3.1/10)
- **Input**: "사용 가능한 계약서 템플릿"
- **Expected Tool**: `listavailabletemplates`
- **Actual Tool**: `(none)`
- **Issues**:
  - Failed to recognize the intent to list contract templates.
  - Did not call the required tool (listavailabletemplates).
  - The response is a question, not a list of templates.
- **Fix**: Improve the prompt to explicitly instruct the AI to list available contract templates when the user asks for them. Consider adding examples of user queries and expected tool calls in the prompt.

**`message-002`** (score: 5.0/10)
- **Input**: "새 메시지 템플릿 만들어줘"
- **Expected Tool**: `createmessage`
- **Actual Tool**: `(none)`
- **Issues**:
  - The AI failed to call the required tool.
  - The AI's response is conversational but did not use any tools.
- **Fix**: The prompt should explicitly instruct the AI to use the 'createmessage' tool when the user requests a new message template.

... and 12 more failures
