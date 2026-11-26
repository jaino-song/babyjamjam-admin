import { NextRequest } from "next/server";

import { initialDocumentActionPost } from "@/app/api/eformsign-docs/jobs/initial-document-action";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ revisionId: string; documentStateId: string }> },
) {
  return initialDocumentActionPost(request, "confirm-no-provider-document", await params);
}
