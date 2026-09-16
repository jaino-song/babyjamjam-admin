import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { authRequiredResponse, errorResponse, upstreamFetchErrorResponse } from '@/lib/api/route-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) {
    return authRequiredResponse();
  }

  try {
    const response = await fetch(`${API_BASE_URL}/admin/feedback/stats`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return upstreamFetchErrorResponse(response, 'fetch admin feedback stats', 'read');
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return errorResponse(error, 'fetch admin feedback stats', 'read');
  }
}
