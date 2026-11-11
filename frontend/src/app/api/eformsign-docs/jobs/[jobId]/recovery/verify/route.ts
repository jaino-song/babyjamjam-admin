import { NextRequest } from 'next/server';
import { manualRecoveryPost } from '../manual-route';

export function POST(request: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  return manualRecoveryPost(request, context, 'verify');
}
