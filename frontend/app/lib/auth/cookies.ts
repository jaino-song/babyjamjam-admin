import { api } from "@/app/lib/axios";
import { cookies } from "next/headers";

export async function getCurrentUser() {
    try {
      // For server-side rendering, try to get cookie from Next.js request
      // For cross-origin cookies, the cookie may not be accessible here,
      // but it will be sent automatically with client-side requests via withCredentials
      const cookieStore = await cookies();
      const authToken = cookieStore.get('auth_token');
      
      // If cookie is available (server-side), send it manually
      // Otherwise, rely on withCredentials to send it automatically (client-side)
      const headers: Record<string, string> = {};
      if (authToken) {
        headers.Cookie = `auth_token=${authToken.value}`;
      }
  
      const { data } = await api.get(`/auth/me`, {
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      });
      return data;
    } catch (error) {
      console.error('Failed to fetch user:', error);
      return null;
    }
  }