# Prompt Improvements (Auto-Generated)

> **Last Updated**: 2026-02-08T20:04:27.735Z
> **Total Suggestions**: 1

---

## 🟢 Low (1)

### TOOL GUIDANCE

- [ ] **Suggestion**: Modify the prompt to explicitly instruct the AI to use the 'updateclient' tool when the user requests a client's information change. The prompt should also guide the AI to extract the necessary arguments (client ID, field to update, new value) from the user's input.
- **Failed Tests**: client-005
- **Impact**: Low impact: Will fix 1 test case(s)

---



---

### Run 2026. 02. 09. 오전 05:04

| Metric | Value |
|--------|-------|
| **Pass Rate** | 95.0% (19/20) |
| **Avg Score** | 9.4/10 |
| **Passed** | 19 |
| **Failed** | 1 |

#### ❌ Failed Tests

**`client-005`** (score: 4.6/10)
- **Input**: "이수진 산모 전화번호 변경해줘"
- **Expected Tool**: `updateclient`
- **Actual Tool**: `(none)`
- **Issues**:
  - The AI failed to call the required tool 'updateclient'.
  - The response is not actionable; it asks for more information but doesn't attempt to use a tool to gather it.
  - The response is generic and doesn't leverage the system's capabilities.
- **Fix**: Modify the prompt to explicitly instruct the AI to use the 'updateclient' tool when the user requests a client's information change. The prompt should also guide the AI to extract the necessary arguments (client ID, field to update, new value) from the user's input.



---

### Run 2026. 02. 09. 오전 05:06

| Metric | Value |
|--------|-------|
| **Pass Rate** | 100.0% (20/20) |
| **Avg Score** | 9.7/10 |
| **Passed** | 20 |
| **Failed** | 0 |


---

### Run 2026. 02. 09. 오전 05:06

| Metric | Value |
|--------|-------|
| **Pass Rate** | 100.0% (13/13) |
| **Avg Score** | 9.6/10 |
| **Passed** | 13 |
| **Failed** | 0 |


---

### Run 2026. 02. 09. 오후 02:37

| Metric | Value |
|--------|-------|
| **Pass Rate** | 100.0% (10/10) |
| **Avg Score** | 9.8/10 |
| **Passed** | 10 |
| **Failed** | 0 |
