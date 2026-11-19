// Fictional display identity only. Does not authenticate or grant permissions.
export function useInitialUser(): { name: string; branchName: string } {
  return { name: '사용자', branchName: '개발QA점' };
}
