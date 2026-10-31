/** Refresh authority without clearing drafts, logging out, or awaiting the refused query itself. */
export async function invalidateAuthUser(): Promise<void> {
    // Lazy imports avoid the API client -> auth hook -> API client cycle at load time.
    const [{ getQueryClient }, { AUTH_USER_QUERY_KEY }] = await Promise.all([
        import("@/lib/queryClient"),
        import("@/hooks/useGetAuthUser"),
    ]);
    void getQueryClient().invalidateQueries(
        { queryKey: AUTH_USER_QUERY_KEY, exact: true },
        { cancelRefetch: false },
    ).catch(() => undefined);
}
