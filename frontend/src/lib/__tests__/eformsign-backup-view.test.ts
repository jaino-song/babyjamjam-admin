import {
  CONTRACT_MILESTONES, RECORD_MILESTONES, cloneDocumentScope, defaultDocumentScope,
  documentScopeSummary, isCalendarDate, kstToday, matchesDocumentScope,
  validateDocumentScope, withPeriod,
} from '../eformsign-backup-view';

describe('document milestone scope', () => {
  it('uses the six contract and four record business milestones', () => {
    expect(CONTRACT_MILESTONES).toEqual([
      { id: 'created', label: '문서 생성' }, { id: 'sent', label: '발송 완료' },
      { id: 'opened', label: '이용자 문서 열람' }, { id: 'signed', label: '이용자 서명 완료' },
      { id: 'reviewed', label: '제공기관 검토 완료' }, { id: 'completed', label: '계약서 완료' },
    ]);
    expect(RECORD_MILESTONES).toEqual([
      { id: 'created', label: '문서 생성' }, { id: 'sent', label: '발송 완료' },
      { id: 'reviewed', label: '제공기관 검토 완료' }, { id: 'completed', label: '제공기록지 완료' },
    ]);
    expect(documentScopeSummary(defaultDocumentScope())).toBe('전체 기간 · 전체 종류 · 전체 단계');
  });

  it('clones arrays, deduplicates and normalizes stage order', () => {
    const scope = { ...defaultDocumentScope(), contractStages: ['completed', 'created', 'completed'] as const };
    const input = { ...scope, contractStages: [...scope.contractStages] };
    const cloned = cloneDocumentScope(input);
    expect(cloned.contractStages).toEqual(['created', 'completed']);
    cloned.contractStages.pop();
    cloned.recordStages.pop();
    expect(input.contractStages).toEqual(['completed', 'created', 'completed']);
    expect(input.recordStages).toHaveLength(4);
  });

  it('derives today from Korea time across the UTC midnight boundary', () => {
    expect(kstToday(new Date('2026-11-04T14:59:59Z'))).toBe('2026-11-04');
    expect(kstToday(new Date('2026-11-04T15:00:00Z'))).toBe('2026-11-05');
  });

  it.each([['7', '2026-10-30'], ['30', '2026-10-07']] as const)('makes the last %s days inclusive', (preset, start) => {
    const scope = withPeriod(defaultDocumentScope(), preset, '2026-11-05');
    expect(scope).toMatchObject({ start, end: '2026-11-05', period: preset });
    expect(matchesDocumentScope(scope, { kind: 'contract', stage: 'created', createdDate: start })).toBe(true);
    expect(matchesDocumentScope(scope, { kind: 'record', stage: 'created', createdDate: '2026-11-05' })).toBe(true);
    expect(matchesDocumentScope(scope, { kind: 'record', stage: 'created', createdDate: '2026-11-06' })).toBe(false);
  });

  it('uses calendar math across year and leap-day boundaries', () => {
    expect(withPeriod(defaultDocumentScope(), '7', '2027-01-03').start).toBe('2026-12-28');
    expect(withPeriod(defaultDocumentScope(), '7', '2024-03-01').start).toBe('2024-02-24');
    expect(() => withPeriod(defaultDocumentScope(), '7', '2026-02-30')).toThrow(RangeError);
  });

  it.each(['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '0000-01-01', 'invalid'])('rejects invalid calendar date %s', date => {
    expect(isCalendarDate(date)).toBe(false);
    expect(validateDocumentScope({ ...defaultDocumentScope(), period: 'custom', start: date }).period).toBe('올바른 날짜를 입력하세요');
  });

  it('accepts open bounds and rejects a reversed range', () => {
    const scope = { ...defaultDocumentScope(), period: 'custom' as const, start: '2026-11-05' };
    expect(validateDocumentScope(scope)).toEqual({});
    expect(matchesDocumentScope(scope, { kind: 'record', stage: 'sent', createdDate: '2026-11-04' })).toBe(false);
    expect(matchesDocumentScope(scope, { kind: 'record', stage: 'sent', createdDate: '2026-11-05' })).toBe(true);
    expect(validateDocumentScope({ ...scope, end: '2026-11-04' }).period).toBeDefined();
    const endOnly = { ...scope, start: '', end: '2026-11-05' };
    expect(validateDocumentScope(endOnly)).toEqual({});
    expect(matchesDocumentScope(endOnly, { kind: 'record', stage: 'sent', createdDate: '2026-11-05' })).toBe(true);
    expect(matchesDocumentScope(endOnly, { kind: 'record', stage: 'sent', createdDate: '2026-11-06' })).toBe(false);
    expect(withPeriod(scope, 'all', '2026-11-05')).toMatchObject({ start: '', end: '', period: 'all' });
  });

  it('validates only relevant kinds and preserves hidden stage choices', () => {
    const scope = { ...defaultDocumentScope(), contractStages: [], recordStages: [] };
    expect(validateDocumentScope(scope)).toEqual({ contractStages: '계약서 단계를 선택하세요', recordStages: '제공기록지 단계를 선택하세요' });
    expect(validateDocumentScope({ ...scope, kind: 'contract' })).toEqual({ contractStages: '계약서 단계를 선택하세요' });
    const recordOnly = { ...scope, kind: 'record' as const, recordStages: ['sent'] as const };
    const cloned = cloneDocumentScope({ ...recordOnly, recordStages: [...recordOnly.recordStages] });
    expect(validateDocumentScope(cloned)).toEqual({});
    expect(cloned.contractStages).toEqual([]);
    expect(documentScopeSummary(cloned)).toContain('제공기록지 발송 완료');
  });

  it('matches the current highest stage rather than every milestone previously reached', () => {
    const scope = { ...defaultDocumentScope(), contractStages: ['sent'] as const };
    const filter = { ...scope, contractStages: [...scope.contractStages] };
    expect(matchesDocumentScope(filter, { kind: 'contract', stage: 'sent', createdDate: '2026-11-05' })).toBe(true);
    expect(matchesDocumentScope(filter, { kind: 'contract', stage: 'signed', createdDate: '2026-11-05' })).toBe(false);
    expect(matchesDocumentScope({ ...filter, kind: 'contract' }, { kind: 'record', stage: 'sent', createdDate: '2026-11-05' })).toBe(false);
  });
});
