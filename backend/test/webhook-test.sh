#!/bin/bash
set -euo pipefail

# Eformsign Webhook Test Script
# Based on: https://eformsignkr.github.io/developers/help/eformsign_webhook.html

# Configuration
WEBHOOK_URL="${1:-http://localhost:4000/webhooks/eformsign}"
DOCUMENT_ID="${2:-test-doc-$(date +%s)}"
WEBHOOK_SECRET="${EFORMSIGN_WEBHOOK_SECRET:-}"

command -v curl >/dev/null || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 1; }

if [[ ! "$WEBHOOK_URL" =~ ^https?:// ]]; then
    echo "WEBHOOK_URL must start with http:// or https://" >&2
    exit 2
fi

case "$WEBHOOK_URL" in
    http://localhost:*|http://127.0.0.1:*|http://[::1]*|https://localhost:*|https://127.0.0.1:*|https://[::1]*)
        ;;
    *)
        if [ "${ALLOW_REMOTE_WEBHOOK_TEST:-}" != "1" ]; then
            echo "Refusing to send webhook test payloads to non-local URL: $WEBHOOK_URL" >&2
            echo "Set ALLOW_REMOTE_WEBHOOK_TEST=1 to run this against a remote endpoint." >&2
            exit 2
        fi
        ;;
esac

echo "=== Eformsign Webhook Test ==="
echo "URL: $WEBHOOK_URL"
echo "Document ID: $DOCUMENT_ID"
if [ -n "$WEBHOOK_SECRET" ]; then
    echo "Auth: Bearer token configured"
else
    echo "Auth: No token (set EFORMSIGN_WEBHOOK_SECRET env var)"
fi
echo ""

# Helper function to make authenticated webhook calls
webhook_call() {
    local payload="$1"
    if [ -n "$WEBHOOK_SECRET" ]; then
        curl -sS --connect-timeout 5 --max-time 30 -X POST "$WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $WEBHOOK_SECRET" \
            -d "$payload"
    else
        curl -sS --connect-timeout 5 --max-time 30 -X POST "$WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "$payload"
    fi
}

# Test 1: Document Created
echo "1. Testing doc_create event..."
webhook_call '{
    "webhook_id": "test-webhook-001",
    "webhook_name": "Test Webhook",
    "company_id": "test-company",
    "event_type": "document",
    "document": {
      "id": "'"$DOCUMENT_ID"'",
      "document_title": "테스트 계약서",
      "template_id": "template-001",
      "template_name": "산모 돌봄 서비스 계약서",
      "workflow_seq": 1,
      "workflow_name": "서명 요청",
      "template_version": "1.0",
      "history_id": "history-001",
      "status": "doc_create",
      "editor_id": "user-001",
      "updated_date": '"$(date +%s000)"'
    }
  }' | jq .
echo ""

# Test 2: Document Action - Participant Opened
echo "2. Testing document_action (doc_open_participant) event..."
webhook_call '{
    "webhook_id": "test-webhook-001",
    "webhook_name": "Test Webhook",
    "company_id": "test-company",
    "event_type": "document_action",
    "document": {
      "id": "'"$DOCUMENT_ID"'",
      "document_title": "테스트 계약서",
      "template_id": "template-001",
      "template_name": "산모 돌봄 서비스 계약서",
      "workflow_seq": 2,
      "workflow_name": "산모 서명",
      "action": "doc_open_participant",
      "updated_date": '"$(date +%s000)"'
    }
  }' | jq .
echo ""

# Test 3: Participant Accepted (Signed)
echo "3. Testing doc_accept_participant event..."
webhook_call '{
    "webhook_id": "test-webhook-001",
    "webhook_name": "Test Webhook",
    "company_id": "test-company",
    "event_type": "document",
    "document": {
      "id": "'"$DOCUMENT_ID"'",
      "document_title": "테스트 계약서",
      "template_id": "template-001",
      "template_name": "산모 돌봄 서비스 계약서",
      "workflow_seq": 2,
      "workflow_name": "산모 서명",
      "status": "doc_accept_participant",
      "updated_date": '"$(date +%s000)"'
    }
  }' | jq .
echo ""

# Test 4: Document Complete
echo "4. Testing doc_complete event..."
webhook_call '{
    "webhook_id": "test-webhook-001",
    "webhook_name": "Test Webhook",
    "company_id": "test-company",
    "event_type": "document",
    "document": {
      "id": "'"$DOCUMENT_ID"'",
      "document_title": "테스트 계약서",
      "template_id": "template-001",
      "template_name": "산모 돌봄 서비스 계약서",
      "workflow_seq": 3,
      "workflow_name": "완료",
      "status": "doc_complete",
      "updated_date": '"$(date +%s000)"'
    }
  }' | jq .
echo ""

# Test 5: Rejection scenario (optional)
echo "5. Testing doc_reject_participant event..."
webhook_call '{
    "webhook_id": "test-webhook-001",
    "webhook_name": "Test Webhook",
    "company_id": "test-company",
    "event_type": "document",
    "document": {
      "id": "'"$DOCUMENT_ID"'-rejected",
      "document_title": "거부 테스트 계약서",
      "template_id": "template-001",
      "template_name": "산모 돌봄 서비스 계약서",
      "workflow_seq": 2,
      "workflow_name": "산모 서명",
      "status": "doc_reject_participant",
      "updated_date": '"$(date +%s000)"'
    }
  }' | jq .
echo ""

# Test 6: PDF Ready event
echo "6. Testing ready_document_pdf event..."
webhook_call '{
    "webhook_id": "test-webhook-001",
    "webhook_name": "Test Webhook",
    "company_id": "test-company",
    "event_type": "ready_document_pdf",
    "ready_document_pdf": {
      "document_id": "'"$DOCUMENT_ID"'",
      "document_title": "테스트 계약서",
      "workflow_seq": 3,
      "template_id": "template-001",
      "template_name": "산모 돌봄 서비스 계약서",
      "document_status": "doc_complete"
    }
  }' | jq .
echo ""

echo "=== Test Complete ==="
