import { NextRequest } from "next/server";

import { initialDocumentActionPost } from "../initial-document-action";

export function POST(request: NextRequest) {
  return initialDocumentActionPost(request, "confirm-no-provider-document");
}
