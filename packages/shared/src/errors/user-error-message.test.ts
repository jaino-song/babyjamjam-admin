import { getUserErrorMessage } from './user-error-message';

const response = (status: number, data: unknown) => ({ response: { status, data } });

describe('getUserErrorMessage', () => {
  it('explains the actual duplicate field without exposing internal field names', () => {
    expect(getUserErrorMessage(response(409, { code: 'P2002', field: 'phone' }))).toBe('연락처 정보가 이미 등록돼 있어요.');
    expect(getUserErrorMessage(response(409, { code: 'P2002', field: 'constructor' }))).toBe('같은 정보가 이미 등록돼 있어요.');
  });
  it('prefers the actual business reason over a bare HTTP label', () => {
    expect(getUserErrorMessage(response(400, { message: '주담당과 부담당은 같은 직원일 수 없습니다.', error: 'Bad Request' }))).toBe('주담당과 부담당은 같은 직원일 수 없어요.');
    expect(getUserErrorMessage(response(404, { message: 'Assignment not found' }))).toBe('서비스 배정 정보를 찾을 수 없어요.');
  });
  it('distinguishes network failures, response timeouts and access refusal', () => {
    expect(getUserErrorMessage('Failed to fetch')).toContain('서버에 연결하지 못했어요');
    expect(getUserErrorMessage(response(400, { message: 'Failed to fetch' }))).toContain('입력 정보가 요청 조건에 맞지 않아요');
    expect(getUserErrorMessage(new Error('Network Error'))).toContain('서버에 연결하지 못했어요');
    expect(getUserErrorMessage({ code: 'ECONNABORTED' })).toContain('시간이 초과됐어요');
    expect(getUserErrorMessage(response(403, {}))).toBe('이 작업을 할 권한이 없어요.');
  });
  it('rejects technical details and untrusted 5xx text', () => {
    expect(getUserErrorMessage(response(500, { message: 'password=secret 비밀번호 오류입니다.' }))).toBe('서버 내부 오류로 요청을 처리하지 못했어요.');
    expect(getUserErrorMessage(response(400, { message: 'Prisma SQL query 오류입니다.' }))).not.toMatch(/Prisma|SQL/);
  });
  it('does not invent a reason for an unknown failure or expose English diagnostics', () => {
    expect(getUserErrorMessage(new Error('An unexpected provider failure'))).toContain('정확한 원인은 확인되지 않았어요');
    expect(getUserErrorMessage(null, '저장에 실패했습니다.')).toBe('저장에 실패했어요.');
  });
  it('does not reintroduce unsafe details through the caller fallback', () => {
    const diagnostic = 'Prisma SQL query 오류: password=secret';
    expect(getUserErrorMessage(new Error(diagnostic), diagnostic)).toBe('요청을 처리하지 못했어요. 정확한 원인은 확인되지 않았어요.');
    expect(getUserErrorMessage(new Error('constructor'))).toBe('요청을 처리하지 못했어요. 정확한 원인은 확인되지 않았어요.');
  });

});
