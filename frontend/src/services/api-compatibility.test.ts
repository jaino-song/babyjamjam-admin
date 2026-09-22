import * as legacyApi from "./api";
import { authApi } from "./auth";
import { callIngestTokenApi } from "./call-ingest-tokens";
import { consultationInquiriesApi } from "./consultation-inquiries";
import {
  eformsignApi,
  normalizeDocumentListResponse,
  withEformsignReauth,
} from "./eformsign";
import { messageDeliveryApi } from "./message-delivery";
import { settingsApi } from "./settings";

jest.mock("@/lib/api/client", () => ({ api: {} }));

describe("services/api compatibility entry point", () => {
  it("should expose every legacy runtime export as the original domain instance", () => {
    const domainExports = {
      authApi,
      callIngestTokenApi,
      consultationInquiriesApi,
      eformsignApi,
      messageDeliveryApi,
      normalizeDocumentListResponse,
      settingsApi,
      withEformsignReauth,
    };

    expect(Object.keys(legacyApi).sort()).toEqual(Object.keys(domainExports).sort());
    for (const name of Object.keys(domainExports) as Array<keyof typeof domainExports>) {
      expect(legacyApi[name]).toBe(domainExports[name]);
    }
  });
});
