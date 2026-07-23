import type { EformsignApiListResponse } from "@babyjamjam/shared/types/eformsign";

import { normalizeDocumentListResponse } from "../api";

describe("normalizeDocumentListResponse", () => {
  it("preserves the backend filtered total_rows value", () => {
    const response = {
      documents: [{ id: "service-record-doc" }],
      total_rows: 1,
    } as EformsignApiListResponse;

    expect(normalizeDocumentListResponse(response, { limit: 20, skip: 0 })).toMatchObject({
      total_rows: 1,
      limit: 20,
      skip: 0,
    });
  });
});
