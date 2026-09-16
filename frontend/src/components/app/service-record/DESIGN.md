# Service date selection

Approved mobile direction (2026-09-16): bottom sheet below 640px, centered
compact dialog on larger screens. Reuse FormDialogShell with an opt-in
mobileSheet prop; unrelated dialogs retain their current presentation.

- Title: `{sessionLabel} 서비스 제공일 수정`.
- Current date: `현재 YYYY년 M월 D일`.
- Three full-width date controls with 54px targets; existing business-day
  filtering, invalid-date handling and pending selection behavior stay intact.
- Fixed footer: 취소 / 수정, 52px targets, safe-area bottom inset.
- No applied-date preview or visible save guidance in the selection body.
- Collision confirmation uses the same responsive shell and existing explicit
  cancellation/confirmation transitions. It does not persist records directly.
- Record-level 수정 확인 remains the persistence boundary.

Reference: docs/mockups/service-record-date-mobile-20260916/index.html.
Real-browser visual acceptance is pending because the required Chrome provider
surface is unavailable in this session. DOM/unit tests do not replace it.
