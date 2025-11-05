import { api } from "@/app/lib/axios";
import { cookies } from "next/headers";

export async function getCurrentUser() {
    try {
      const cookieStore = await cookies();
      const authToken = cookieStore.get('auth_token');
      
      if (!authToken) {
        return null;
      }
  
      const { data } = await api.get(`/auth/me`, {
        headers: {
          Cookie: `auth_token=${authToken.value}`,
        },
      });
      return data;
    } catch (error) {
      console.error('Failed to fetch user:', error);
      return null;
    }
  }