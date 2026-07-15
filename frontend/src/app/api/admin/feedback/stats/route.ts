import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
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
