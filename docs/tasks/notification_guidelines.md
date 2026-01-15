# Notification Guidelines

## Daily Summary Notifications (PWA Push)

매일 오전 9시(KST)에 admin/manager 역할의 사용자에게 PWA 푸시 알림을 전송합니다.
해당 조건을 만족하는 클라이언트가 있을 때만 알림이 전송됩니다.

### 1. 서비스 시작 예정 알림
- **조건**: 일주일 내 시작 예정인 서비스가 1건 이상
- **제목**: 서비스 시작 예정
- **내용**: 일주일 내로 시작되는 서비스 {count}건을 확인해 보세요
- **링크**: /clients?filter=starting-soon

### 2. 서비스 종료 예정 알림
- **조건**: 일주일 내 종료 예정인 서비스가 1건 이상
- **제목**: 서비스 종료 예정
- **내용**: 일주일 내로 종료되는 서비스 {count}건을 확인해 보세요
- **링크**: /clients?filter=ending-soon

### 3. 계약서 미완료 경고 알림
- **조건**: 일주일 내 시작 예정 + 계약서 발송됨 + eformsign 상태가 완료(050)가 아닌 클라이언트가 1건 이상
- **제목**: ⚠️ 계약서 미완료
- **내용**: 서비스 시작 예정이지만 계약서가 미완료된 클라이언트 {count}건이 있습니다
- **링크**: /clients?filter=incomplete-contracts

### 4. 계약서 미발송 알림
- **조건**: 일주일 내 시작 예정 + 계약서가 발송되지 않은(eDocId가 null) 클라이언트
- **제목**: 📄 계약서 미발송
- **내용**: {client_name} 님에게 계약서가 발송되지 않았습니다. 계약서를 발송해 주세요.
- **링크**: /clients/{client_id}
- **특이사항**: 클라이언트별로 개별 알림 발송

---

## Notification Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{count}` | 해당 조건의 클라이언트 수 | 3 |

## Target Roles

| Role | Receives Notifications |
|------|------------------------|
| `admin` | Yes |
| `manager` | Yes |
| `user` | Yes |

## Technical Implementation

- **Scheduler**: `PwaNotificationSchedulerService`
- **Cron**: `0 9 * * *` (매일 오전 9시 KST)
- **Method**: `notificationService.sendToRoles(['admin', 'manager'], ...)`

### Related Files
- `backend/application/services/pwa-notification-scheduler.service.ts`
- `backend/application/services/notification.service.ts`
- `backend/domain/repositories/client.repository.interface.ts`
