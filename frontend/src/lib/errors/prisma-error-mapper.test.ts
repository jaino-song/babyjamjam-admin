import { createProblemDetails } from '@babyjamjam/shared';
import { getErrorMessage } from './prisma-error-mapper';

const response = (status: number, data: unknown) => ({ response: { status, data } });

// EM v1.0 client policy: getErrorMessage resolves structured Prisma codes,
// then the shared problem contract (registered codes only), then the localized
// fallback. Raw upstream `message` fields are never translated or rendered.
describe('error presentation (EM v1.0 client contract)', () => {
  it('maps a structured Prisma duplicate-field code through i18n', () => {
    expect(getErrorMessage(response(409, { code: 'P2002', field: 'phone', error: 'Conflict' }), 'ko'))
      .toBe('연락처이(가) 이미 존재해요.');
  });

  it('never translates or renders raw upstream message bodies', () => {
    const generic = '오류가 발생했어요. 다시 시도해 주세요.';
    // English business-reason sentence from the legacy backend
    expect(getErrorMessage(response(400, { message: 'duration must equal the Korean business-day count (15) for the submitted service period', error: 'Bad Request' }), 'ko')).toBe(generic);
    // Korean server sentence
    expect(getErrorMessage(response(400, { error: '서비스 시작일은 종료일보다 늦을 수 없습니다.' }), 'ko')).toBe(generic);
    // Validation message arrays
    expect(getErrorMessage(response(400, { message: ['name must be a string', 'phone must be a valid Korean phone number'], error: 'Bad Request' }), 'ko')).toBe(generic);
  });

  it('uses the localized fallback for non-problem HTTP failures', () => {
    const generic = '오류가 발생했어요. 다시 시도해 주세요.';
    expect(getErrorMessage(response(401, {}), 'ko')).toBe(generic);
    expect(getErrorMessage(response(403, {}), 'ko')).toBe(generic);
    expect(getErrorMessage(response(500, {}), 'ko')).toBe(generic);
  });

  it('resolves a verified problem body to its registered catalog copy', () => {
    const problem = createProblemDetails({ code: 'RESOURCE_NOT_FOUND', requestId: 'req-1f-safe-identifier' });
    expect(getErrorMessage(response(404, problem), 'ko')).toBe('요청한 정보를 찾을 수 없어요.');
  });

  it.each([
    'SELECT phone FROM Client WHERE id = 73',
    'SELECT "phone", "email" FROM "Client" WHERE "id" = 73',
    'PrismaClientKnownRequestError: Invalid prisma invocation SELECT * FROM Client',
    'Error: database connection failed at /app/src/clients.service.ts:42',
    'upstream rejected Bearer abc.def.ghi',
    'password: hunter2',
    'Invalid API key: sk_test_secret',
  ])('does not expose technical or credential diagnostics: %s', (message) => {
    const result = getErrorMessage(response(409, { message }), 'ko');
    expect(result).toBe('오류가 발생했어요. 다시 시도해 주세요.');
    expect(result).not.toContain(message);
  });

  it('keeps the caller-supplied fallback key for unknown local errors', () => {
    expect(getErrorMessage(new Error('Network Error'), 'ko')).toBe('오류가 발생했어요. 다시 시도해 주세요.');
    expect(getErrorMessage(null, 'ko', 'clients.form.error-save-failed')).toBe('저장에 실패했어요. 다시 시도해 주세요.');
  });
});
