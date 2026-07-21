import assert from "node:assert/strict";
import test from "node:test";

import {
  getLegacyDocumentCustomerName,
  getLegacyDocumentStatusCategory,
  mapLegacyDocumentStatusToLabel,
} from "../src/app/lib/eformsign/status-codes.ts";

test("legacy treats provider confirmation and reviewer requests as completed", () => {
  assert.equal(
    getLegacyDocumentStatusCategory({
      status_type: "060",
      step_type: "05",
      step_name: "제공기관 확인",
    }),
    "completed",
  );
  assert.equal(
    getLegacyDocumentStatusCategory({
      status_type: "070",
      step_type: "06",
      step_name: "제공기관 검토",
    }),
    "completed",
  );
  assert.equal(
    mapLegacyDocumentStatusToLabel({
      status_type: "060",
      step_type: "05",
      step_name: "제공기관 확인",
    }),
    "완료",
  );
});

test("legacy keeps the customer participant step in progress", () => {
  assert.equal(
    getLegacyDocumentStatusCategory({
      status_type: "060",
      step_type: "05",
      step_name: "이용자",
    }),
    "in-progress",
  );
});

test("legacy customer name comes from document recipients before provider-owned actors", () => {
  assert.equal(
    getLegacyDocumentCustomerName(
      {
        recipients: [
          { recipient_type: "02", name: "송가연" },
          { recipient_type: "01", name: "인천 아이미래로" },
        ],
        current_status: {
          step_recipients: [{ recipient_type: "01", name: "인천 아이미래로" }],
        },
        last_editor: { name: "인천 아이미래로" },
        creator: { name: "인천 아이미래로" },
      },
      ["송진호", "인천 아이미래로"],
    ),
    "송가연",
  );
});

test("legacy omits a document when every actor is internal", () => {
  assert.equal(
    getLegacyDocumentCustomerName(
      {
        recipients: [{ recipient_type: "01", name: "인천 아이미래로" }],
        current_status: {
          step_recipients: [{ recipient_type: "01", name: "인천 아이미래로" }],
        },
        last_editor: { name: "인천 아이미래로" },
        creator: { name: "인천 아이미래로" },
      },
      ["송진호", "인천 아이미래로"],
    ),
    null,
  );
});
