/** Refresh authority without clearing drafts, logging out, or awaiting the refused query itself. */
export async function invalidateAuthUser(): Promise<void> {
    // Keep transport imports hook-free for Server Components and route handlers.
    const [{ getQueryClient }, { AUTH_USER_QUERY_KEY }] = await Promise.all([
        import("@/lib/queryClient"),
        import("@/lib/auth/query-keys"),
    ]);
    void getQueryClient().invalidateQueries(
        { queryKey: AUTH_USER_QUERY_KEY, exact: true },
        { cancelRefetch: false },
    ).catch(() => undefined);
}
