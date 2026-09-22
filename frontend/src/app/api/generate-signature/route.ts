import { NextRequest } from "next/server";

import { localProblemResponse } from "@/lib/api/route-utils";

/** Browser provider primitives are retired in favour of server-mediated jobs. */
export async function POST(_request: NextRequest) {
    return localProblemResponse("EFORMSIGN_PROVIDER_OPERATION_SERVER_ONLY");
}
