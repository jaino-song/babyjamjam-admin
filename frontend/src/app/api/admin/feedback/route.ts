import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { authRequiredResponse, errorResponse, upstreamFetchErrorResponse } from '@/lib/api/route-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) {
    return authRequiredResponse();
  }

  const { searchParams } = new URL(request.url);
  const page = searchParams.get('page') || '1';
  const limit = searchParams.get('limit') || '20';
  const type = searchParams.get('type');

  const params = new URLSearchParams({ page, limit });
  if (type) params.append('type', type);

  try {
    const response = await fetch(`${API_BASE_URL}/admin/feedback?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return upstreamFetchErrorResponse(response, 'fetch admin feedback', 'read');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return errorResponse(error, 'fetch admin feedback', 'read');
  }
}
