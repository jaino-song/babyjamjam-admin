import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { unauthorizedProblemResponse, upstreamBodyErrorResponse } from '@/lib/api/problem-responses';
import { BACKEND_BASE_URL } from '@/lib/api/server';

const API_BASE_URL = BACKEND_BASE_URL;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) {
    return unauthorizedProblemResponse();
  }

  const { searchParams } = new URL(request.url);
  const page = searchParams.get('page') || '1';
  const limit = searchParams.get('limit') || '20';
  const type = searchParams.get('type');

  const params = new URLSearchParams({ page, limit });
  if (type) params.append('type', type);

  const response = await fetch(`${API_BASE_URL}/admin/feedback?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const upstreamText = await response.text().catch(() => '');
    return upstreamBodyErrorResponse(response.status, upstreamText, 'fetch feedback list', 'read');
  }

  const data = await response.json();
  return NextResponse.json(data);
}
