import { getErrorMessage } from './api-error-mapper';

const response = (status: number, data: unknown) => ({ response: { status, data } });

describe('Korean error presentation', () => {
  it('uses the actual duplicate field in Korean even with the English locale', () => {
    expect(getErrorMessage(response(409, { code: 'P2002', field: 'phone', error: 'Conflict' }), 'en')).toBe('연락처 정보가 이미 등록돼 있어요.');
  });
  it('translates a business reason and preserves its service-day count', () => {
    expect(getErrorMessage(response(400, { message: 'duration must equal the Korean business-day count (15) for the submitted service period', error: 'Bad Request' }), 'ko')).toBe('서비스 기간의 실제 이용일 수는 15일이에요. 입력한 이용일 수를 확인해 주세요.');
    expect(getErrorMessage(response(400, { error: '서비스 시작일은 종료일보다 늦을 수 없습니다.' }), 'ko')).toBe('서비스 시작일은 종료일보다 늦을 수 없어요.');
  });
  it('explains individual validation failures instead of an HTTP label', () => {
    expect(getErrorMessage(response(400, { message: ['name must be a string', 'phone must be a valid Korean phone number'], error: 'Bad Request' }), 'ko')).toBe('이름 항목은 문자로 입력해 주세요. 연락처 항목에 올바른 국내 전화번호를 입력해 주세요.');
  });
  it.each([
    [401, '로그인 인증을 확인할 수 없어요. 다시 로그인해 주세요.'],
    [403, '이 작업을 할 권한이 없어요.'],
    [500, '서버 내부 오류로 요청을 처리하지 못했어요.'],
  ])('explains a known HTTP failure (%s) without inventing a more specific reason', (status, expected) => {
    expect(getErrorMessage(response(status as number, {}), 'ko')).toBe(expected);
  });
  it.each([
    "SELECT 1 FROM clients",
    "SELECT id + 1 FROM clients",
    "SELECT 'client' AS label FROM clients",
    "SELECT CASE WHEN id = 1 THEN 'one' ELSE 'other' END FROM clients",
    "SELECT CAST(id AS TEXT) AS label FROM clients",
    "SELECT (COALESCE(id, 0) + 1) AS next_id FROM clients",
    "SELECT (SELECT 1 FROM related_clients) AS related_count FROM clients",
    "SELECT \"id\" AS \"client_id\" FROM \"clients\"",
    "SELECT u.id FROM users u",
    "SELECT u.id FROM users AS u WHERE u.id = 1",
    "SELECT u.id FROM users u JOIN teams t ON t.id = u.team_id",
    'SELECT phone FROM Client WHERE id = 73',
    'SELECT phone FROM Client',
    'SELECT phone FROM Client;',
    'SELECT phone, email FROM Client WHERE id = 73',
    'SELECT "phone", "email" FROM "Client" WHERE "id" = 73',
    'SELECT count(*) FROM Client WHERE id = 73;',
    'SELECT COUNT(*) FROM Client',
    'PrismaClientKnownRequestError: Invalid prisma invocation SELECT * FROM Client',
    'Error: database connection failed at /app/src/clients.service.ts:42',
    'upstream rejected Bearer abc.def.ghi',
    'password: hunter2',
    'Invalid API key: sk_test_secret',
  ])('does not expose technical or credential diagnostics: %s', (message) => {
    expect(getErrorMessage(response(409, { message }), 'ko')).toBe('현재 데이터 상태와 요청이 충돌해 처리할 수 없어요.');
  });
  it('distinguishes network failure from an unknown local error', () => {
    expect(getErrorMessage(new Error('Network Error'), 'ko')).toBe('서버에 연결하지 못했어요. 인터넷 연결 상태를 확인해 주세요.');
    expect(getErrorMessage(null, 'ko', 'clients.form.error-save-failed')).toBe('저장하지 못했어요. 다시 시도해 주세요');
  });
});
