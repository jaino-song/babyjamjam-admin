# Notification Guidelines

## When to send notifications

### Client CRUD Operations

1. **When a new client is added**, send a notification about it:
- Korean: {client_name} 님이 이용자로 추가되었습니다
- English: {client_name} is added as a client.

2. **When a client is deleted**, send a notification about it:
- Korean: {client_name} 님이 이용자에서 삭제되었습니다
- English: {client_name} is deleted.

3. **When a client's info is edited**, send a notification about it:
- Korean: {client_name} 님의 정보가 수정되었습니다
- English: {client_name}'s info is edited.

### Start Date Reminders

4. **If a client's start date is in 7 days**, send a notification about it:
- Korean: {client_name} 님의 서비스 시작일이 7일 남았습니다 ({start_date})
- English: {client_name}'s service start date is in 7 days ({start_date}).

5. **If a client's start date is in 3 days**, send a notification about it:
- Korean: {client_name} 님의 서비스 시작일이 3일 남았습니다 ({start_date})
- English: {client_name}'s service start date is in 3 days ({start_date}).

6. **If a client's start date is in 1 day**, send a notification about it:
- Korean: {client_name} 님의 서비스 시작일이 내일입니다 ({start_date})
- English: {client_name}'s service starts tomorrow ({start_date}).

### Contract/Document Warnings

7. **If a client's start date is in 3 days, but the eformsign document is not completed**, send a warning notification:
- Korean: ⚠️ {client_name} 님의 서비스 시작일이 3일 남았으나, 계약서가 아직 완료되지 않았습니다
- English: ⚠️ {client_name}'s service starts in 3 days, but the contract is not yet completed.

8. **If a client's start date is in 1 day, but the eformsign document is not completed**, send an urgent warning notification:
- Korean: 🚨 {client_name} 님의 서비스 시작일이 내일이지만, 계약서가 아직 완료되지 않았습니다
- English: 🚨 {client_name}'s service starts tomorrow, but the contract is not yet completed.

### End Date Reminders

9. **If a client's end date is in 7 days**, send a notification about it:
- Korean: {client_name} 님의 서비스 종료일이 7일 남았습니다 ({end_date})
- English: {client_name}'s service end date is in 7 days ({end_date}).

10. **If a client's end date is in 3 days**, send a notification about it:
- Korean: {client_name} 님의 서비스 종료일이 3일 남았습니다 ({end_date})
- English: {client_name}'s service end date is in 3 days ({end_date}).

11. **If a client's end date is in 1 day**, send a notification about it:
- Korean: {client_name} 님의 서비스가 내일 종료됩니다 ({end_date})
- English: {client_name}'s service ends tomorrow ({end_date}).

### Eformsign Document Status

12. **If a client's eformsign document status changes to completed**, send a notification about it:
- Korean: ✅ {client_name} 님의 계약서가 완료되었습니다
- English: ✅ {client_name}'s contract has been completed.

13. **If a client's eformsign document status changes to rejected**, send a notification about it:
- Korean: ❌ {client_name} 님의 계약서가 거부되었습니다/
- English: ❌ {client_name}'s contract has been rejected.

---

## Notification Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{client_name}` | Client's full name | 홍길동 |
| `{start_date}` | Service start date | 2025-01-20 |
| `{end_date}` | Service end date | 2025-12-31 |

## Notification Priority Levels

| Priority | Use Case | Icon |
|----------|----------|------|
| High | Urgent contract warnings (1 day before) | 🚨 |
| Medium | Contract warnings (3 days before) | ⚠️ |
| Normal | Date reminders, status updates | (none) |
| Success | Contract completed | ✅ |
| Error | Contract rejected | ❌ |
