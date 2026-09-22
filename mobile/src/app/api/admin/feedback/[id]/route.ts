import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unauthorizedProblemResponse, upstreamBodyErrorResponse } from '@/lib/api/problem-responses';
import { BACKEND_BASE_URL } from '@/lib/api/server';

const API_BASE_URL = BACKEND_BASE_URL;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) {
    return unauthorizedProblemResponse();
  }

  const response = await fetch(`${API_BASE_URL}/admin/feedback/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const upstreamText = await response.text().catch(() => '');
    return upstreamBodyErrorResponse(response.status, upstreamText, 'fetch feedback detail', 'read');
  }

  const data = await response.json();
  return NextResponse.json(data);
}
