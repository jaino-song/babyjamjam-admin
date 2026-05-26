import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { BACKEND_BASE_URL } from '@/lib/api/server';

const API_BASE_URL = BACKEND_BASE_URL;

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  
  const response = await fetch(`${API_BASE_URL}/admin/feedback/stats`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  
  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to fetch feedback stats' }, { status: response.status });
  }
  
  const data = await response.json();
  return NextResponse.json(data);
}
