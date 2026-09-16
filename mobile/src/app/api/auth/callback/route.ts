import { requestExpiredProblemResponse } from "@/lib/api/problem-responses";

export function GET() {
    return requestExpiredProblemResponse("Legacy token callback is disabled");
}
