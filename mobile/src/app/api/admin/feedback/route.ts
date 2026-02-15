import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  
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
    return NextResponse.json({ error: 'Failed to fetch feedback' }, { status: response.status });
  }
  
  const data = await response.json();
  return NextResponse.json(data);
}
