/** @jest-environment node */
import * as staffRegenerateRoute from "@/app/api/eformsign-docs/jobs/regenerate-initial/route";
import * as staffConfirmRoute from "@/app/api/eformsign-docs/jobs/confirm-no-provider-document/route";
import * as adminConfirmRoute from "@/app/api/admin/service-records/revisions/[revisionId]/documents/[documentStateId]/confirm-no-provider-document/route";

import * as legacyApi from "./api";
import { authApi } from "./auth";
import { callIngestTokenApi } from "./call-ingest-tokens";
import { consultationInquiriesApi } from "./consultation-inquiries";
import {
  EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES,
  eformsignApi,
  normalizeDocumentListResponse,
  withEformsignReauth,
} from "./eformsign";
import { messageDeliveryApi } from "./message-delivery";
import { isNotificationSendTimeout, notificationSendApi } from "./notification-send";
import { messagePolicyApi, settingsApi } from "./settings";

jest.mock("@/lib/api/client", () => ({ api: {} }));
jest.mock("@/lib/api/server", () => ({ serverAPIClient: {} }));

describe("services/api compatibility entry point", () => {
  it("should expose every legacy runtime export as the original domain instance", () => {
    const domainExports = {
      EFORMSIGN_DOCUMENT_JOB_FAILURE_REASON_CODES,
      authApi,
      callIngestTokenApi,
      consultationInquiriesApi,
      eformsignApi,
      isNotificationSendTimeout,
      messageDeliveryApi,
      messagePolicyApi,
      normalizeDocumentListResponse,
      notificationSendApi,
      settingsApi,
      withEformsignReauth,
    };

    expect(Object.keys(legacyApi).sort()).toEqual(Object.keys(domainExports).sort());
    for (const name of Object.keys(domainExports) as Array<keyof typeof domainExports>) {
      expect(legacyApi[name]).toBe(domainExports[name]);
    }
  });
});

const initialRecoveryRouteExports = { staffRegenerateRoute, staffConfirmRoute, adminConfirmRoute };

it.each(Object.entries(initialRecoveryRouteExports))("%s exports POST for the initial document action", (_name, route) => {
  expect(Object.keys(route)).toEqual(["POST"]);
  expect(route.POST).toEqual(expect.any(Function));
});
