import { localProblemResponse } from "@/lib/api/route-utils";

export function GET() {
    return localProblemResponse("REQUEST_EXPIRED");
}
