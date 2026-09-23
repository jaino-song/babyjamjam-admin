import { NextRequest } from "next/server";

import { localProblemResponse } from "@/lib/api/route-utils";

/** Provider refresh is server-custodied; this path is a tombstone. */
export async function POST(_request: NextRequest) {
    return localProblemResponse("EFORMSIGN_CREDENTIALS_SERVER_ONLY");
}
