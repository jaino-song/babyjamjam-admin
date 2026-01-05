#!/bin/bash
# Eformsign Webhook Test Script
# Based on: https://eformsignkr.github.io/developers/help/eformsign_webhook.html

# Configuration
WEBHOOK_URL="${1:-http://localhost:4000/webhooks/eformsign}"
DOCUMENT_ID="${2:-test-doc-$(date +%s)}"

echo "=== Eformsign Webhook Test ==="
echo "URL: $WEBHOOK_URL"
echo "Document ID: $DOCUMENT_ID"
echo ""

# Test 1: Document Created
echo "1. Testing doc_create event..."
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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

# Test 2: Participant Requested
echo "2. Testing doc_request_participant event..."
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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
      "status": "doc_request_participant",
      "updated_date": '"$(date +%s000)"'
    }
  }' | jq .
echo ""

# Test 3: Participant Accepted (Signed)
echo "3. Testing doc_accept_participant event..."
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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
curl -s -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -d '{
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
