import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/axios/client";
import { usePathname } from "next/navigation";


export const useGetAuthUser = () => {
    const pathname = usePathname();
    const isLoginPage = pathname?.includes('/login');

    return useQuery({
        queryKey: ['authUser'],
        queryFn: async () => {
            const { data } = await api.get('/auth/me');
            if (data) {
                return data;
            } else {
                return false;
            }
        },
        retry: false,
        staleTime: 5 * 60 * 1000, // 5 minutes
        enabled: !isLoginPage,
    });
}