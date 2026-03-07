# API Contract: imirae-incheon.com

**Date:** 2026-03-07
**Version:** 1.0
**Status:** Draft
**Author:** api-architect (Claude Opus)

---

## Overview

The imirae-incheon.com website is a mostly-static marketing site with two server-side interactions:

1. **Contact Form** (`/contact` page) -- full contact form submission
2. **Consultation Request** (modal on Home & Introduction pages) -- quick consultation request

Both endpoints accept form data and send an email notification to the company email address (`forchildrenbysongs@gmail.com`). There is no database, no user authentication, and no session management.

### Implementation Strategy

- **Runtime:** Next.js App Router API Routes (`app/api/.../route.ts`)
- **Email Service:** Resend (recommended) or any SMTP-compatible provider
- **Validation:** Zod schemas (already in project dependencies)
- **Rate Limiting:** Basic IP-based rate limiting via middleware or API route logic

---

## Shared Conventions

### Base URL

All API routes are relative to the application origin:

```
https://imirae-incheon.com/api/v1/...
```

In development: `http://localhost:3000/api/v1/...`

### Response Envelope

All responses follow a consistent envelope shape:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

Or on error:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable error message",
    "details": { ... }
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body failed validation |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests from this IP |
| `EMAIL_SEND_FAILED` | 500 | Email service failed to send |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

### Rate Limiting

Both endpoints enforce a rate limit of **5 requests per IP per 15-minute window**. When exceeded, the endpoint returns a `429` status with `RATE_LIMIT_EXCEEDED` error code.

---

## Endpoints

### POST /api/v1/contact

**Purpose:** Submit the full contact form from the `/contact` page. Sends an email notification to the company.

**Auth:** Public (no authentication required)

**Request:**

- **Content-Type:** `application/json`
- **Body:**

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `name` | `string` | Yes | 1-50 chars | Sender's name |
| `email` | `string` | Yes | Valid email, max 254 chars | Sender's email address |
| `phone` | `string` | Yes | 9-20 chars, digits/hyphens/spaces/+ only | Sender's phone number |
| `subject` | `string` | Yes | 1-100 chars | Message subject |
| `message` | `string` | Yes | 1-2000 chars | Message body |
| `privacyAgreed` | `boolean` | Yes | Must be `true` | Privacy policy consent |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "message": "문의가 성공적으로 접수되었습니다."
  },
  "error": null
}
```

**Error Responses:**

- **400 (Validation Error):**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "입력 정보를 확인해주세요.",
    "details": {
      "fieldErrors": {
        "email": "올바른 이메일 주소를 입력해주세요.",
        "phone": "올바른 전화번호를 입력해주세요."
      }
    }
  }
}
```

- **429 (Rate Limit):**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "잠시 후 다시 시도해주세요."
  }
}
```

- **500 (Email Send Failed):**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "EMAIL_SEND_FAILED",
    "message": "메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요."
  }
}
```

**Notes:**
- The `privacyAgreed` field must be `true` or validation fails. This enforces consent at the API level.
- Phone number regex: `/^[0-9+\-\s]{9,20}$/` -- allows Korean and international formats.

---

### POST /api/v1/consultation

**Purpose:** Submit a quick consultation request from the popup modal (Home & Introduction pages). Sends an email notification to the company.

**Auth:** Public (no authentication required)

**Request:**

- **Content-Type:** `application/json`
- **Body:**

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `name` | `string` | Yes | 1-50 chars | Requester's name |
| `phone` | `string` | Yes | 9-20 chars, digits/hyphens/spaces/+ only | Requester's phone number |
| `dueDate` | `string` | No | ISO 8601 date (YYYY-MM-DD), must be today or future | Expected due date (출산 예정일) |
| `message` | `string` | No | Max 500 chars | Additional message or notes |
| `privacyAgreed` | `boolean` | Yes | Must be `true` | Privacy policy consent |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "message": "상담 신청이 접수되었습니다. 빠른 시일 내에 연락드리겠습니다."
  },
  "error": null
}
```

**Error Responses:**

- **400 (Validation Error):**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "입력 정보를 확인해주세요.",
    "details": {
      "fieldErrors": {
        "phone": "올바른 전화번호를 입력해주세요."
      }
    }
  }
}
```

- **429 (Rate Limit):**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "잠시 후 다시 시도해주세요."
  }
}
```

- **500 (Email Send Failed):**

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "EMAIL_SEND_FAILED",
    "message": "메일 전송에 실패했습니다. 잠시 후 다시 시도해주세요."
  }
}
```

**Notes:**
- The consultation form is intentionally simpler than the contact form -- it's a quick CTA, not a full inquiry.
- `dueDate` is relevant because this is a postpartum care service; knowing the due date helps the company prioritize outreach.
- Email is not collected here -- the company will call back on the provided phone number.

---

## Email Notification Format

Both endpoints send an email to `forchildrenbysongs@gmail.com`. The email subject and body differ:

### Contact Form Email

- **To:** `forchildrenbysongs@gmail.com`
- **Subject:** `[웹사이트 문의] {subject}`
- **Reply-To:** `{email}` (the sender's email)
- **Body:** Plain text or simple HTML containing all submitted fields

### Consultation Request Email

- **To:** `forchildrenbysongs@gmail.com`
- **Subject:** `[상담 신청] {name}님`
- **Body:** Plain text or simple HTML containing name, phone, due date (if provided), and message (if provided)

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `RESEND_API_KEY` | API key for the email service | `re_xxxxx` |
| `CONTACT_EMAIL` | Recipient email for notifications | `forchildrenbysongs@gmail.com` |

---

## File Structure (Implementation Guide)

```
app/
  api/
    v1/
      contact/
        route.ts        # POST handler
      consultation/
        route.ts        # POST handler
lib/
  email.ts              # Email sending utility (wraps Resend/SMTP)
  rate-limit.ts         # Rate limiting utility
types/
  api.ts                # Request/response type definitions
  models.ts             # Shared model interfaces
```

---

## Type Definitions

All TypeScript types are defined in `types/api.ts` and `types/models.ts`. Implementation agents MUST import from these files -- no inline type definitions.
