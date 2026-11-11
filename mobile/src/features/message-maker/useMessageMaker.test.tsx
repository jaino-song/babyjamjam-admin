import { act, renderHook } from '@testing-library/react';

import { useBankAccountInfos, useVoucherPriceInfos } from '@/hooks/useVoucherData';
import { useMessageMaker } from './useMessageMaker';
import { copyMakerBody } from './clipboard';
import type { MakerOption } from './model';

jest.mock('@/hooks/useVoucherData', () => ({ useBankAccountInfos: jest.fn(), useVoucherPriceInfos: jest.fn() }));
jest.mock('./clipboard', () => ({ copyMakerBody: jest.fn() }));
const priceOption: MakerOption = { value: 'system:PRICE_INFO', name: '비용 안내', content: '{{name}} {{type}} {{duration}}일 {{weeks}}주 {{fullPrice}} {{grant}} {{actualPrice}} {{area}} {{bankName}} {{accNum}}', variables: [], group: 'mother' };
const custom: MakerOption = { value: 'custom', name: '직접 작성', content: '', variables: [], group: 'custom' };
const query = (data: unknown) => ({ data, isLoading: false, isFetching: false, isError: false, refetch: jest.fn() });
const mockPrices = jest.mocked(useVoucherPriceInfos);
const mockAccounts = jest.mocked(useBankAccountInfos);
const priceRow = { id: 1, type: 'A가1형', duration: '10', fullPrice: '1200000', grant: '1000000', actualPrice: '200000' };
const accountRows = [{ area: 'QA-지역', bankName: 'QA-은행', accNum: 'QA-계좌' }, { area: 'QA-다른지역', bankName: 'QA-은행2', accNum: 'QA-계좌2' }];
function setup() { return renderHook(() => useMessageMaker([custom, priceOption])); }

describe('useMessageMaker', () => {
  beforeEach(() => {
    mockPrices.mockReturnValue(query([priceRow]) as unknown as ReturnType<typeof useVoucherPriceInfos>);
    mockAccounts.mockReturnValue(query(accountRows) as unknown as ReturnType<typeof useBankAccountInfos>);
    jest.mocked(copyMakerBody).mockResolvedValue(true);
  });
  it.each([['Namdonggu', '남동구'], ['QA-unknown-area', 'QA-unknown-area']])('renders the label for %s while selecting API account data by raw id', (area, label) => {
    const account = { area, bankName: 'QA-fictional-bank', accNum: 'QA-fictional-account' };
    mockAccounts.mockReturnValue(query([account]) as unknown as ReturnType<typeof useBankAccountInfos>);
    const { result } = setup();
    act(() => result.current.changeArea(area));
    expect(result.current.area).toBe(area);
    expect(result.current.account).toEqual(account);
    expect(result.current.resolvedValues.area).toBe(label);
    expect(result.current.body).toContain(`${label} QA-fictional-bank QA-fictional-account`);
  });
  it('prefers PRICE_INFO and uses real selected type/year/area data and duration divided by five', () => {
    const { result } = setup();
    expect(result.current.selected.value).toBe('system:PRICE_INFO');
    act(() => result.current.changeVariable('name', 'QA-이름'));
    act(() => result.current.changeVariable('type', 'A가1형'));
    act(() => result.current.changeVariable('duration', '10'));
    act(() => result.current.changeArea('QA-지역'));
    expect(result.current.body).toBe('QA-이름 A가-1형 10일 2주 1,200,000 1,000,000 200,000 QA-지역 QA-은행 QA-계좌');
    expect(mockPrices).toHaveBeenLastCalledWith('A가1형', new Date().getFullYear());
    act(() => result.current.changeArea('QA-다른지역'));
    expect(result.current.body).toContain('QA-은행2 QA-계좌2');
    expect(result.current.body).not.toContain('QA-계좌 ');
  });
  it('clears duration and amounts on year or type changes and sends selected year to the price hook', () => {
    const { result } = setup();
    act(() => result.current.changeVariable('type', 'A가1형'));
    act(() => result.current.changeVariable('duration', '10'));
    act(() => result.current.changeYear(String(new Date().getFullYear() - 1)));
    expect(result.current.values.duration).toBe('');
    expect(result.current.body).toContain('{{fullPrice}}');
    expect(mockPrices).toHaveBeenLastCalledWith('A가1형', new Date().getFullYear() - 1);
    act(() => result.current.changeVariable('duration', '10'));
    act(() => result.current.changeVariable('type', 'A통합1형'));
    expect(result.current.values.duration).toBe('');
    expect(result.current.body).toContain('{{weeks}}');
  });
  it.each(['loading', 'fetching', 'error', 'empty'])('clears stale derived values and body overrides on %s rows without restoring them later', state => {
    const { result, rerender } = setup();
    act(() => result.current.changeVariable('type', 'A가1형'));
    act(() => result.current.changeVariable('duration', '10'));
    act(() => result.current.changeArea('QA-지역'));
    act(() => result.current.changeBody('old overridden price/account'));
    const flags = { isLoading: state === 'loading', isFetching: state === 'fetching', isError: state === 'error' };
    mockPrices.mockReturnValue({ ...query(state === 'empty' ? [] : [priceRow]), ...flags } as unknown as ReturnType<typeof useVoucherPriceInfos>);
    mockAccounts.mockReturnValue({ ...query(state === 'empty' ? [] : accountRows), ...flags } as unknown as ReturnType<typeof useBankAccountInfos>);
    rerender();
    expect(result.current.body).toContain('{{fullPrice}}');
    expect(result.current.body).toContain('{{bankName}}');
    expect(result.current.body).not.toContain('old overridden');
    expect(result.current.values.duration).toBe('');
    expect(result.current.area).toBe('');
    mockPrices.mockReturnValue(query([priceRow]) as unknown as ReturnType<typeof useVoucherPriceInfos>);
    mockAccounts.mockReturnValue(query(accountRows) as unknown as ReturnType<typeof useBankAccountInfos>);
    rerender();
    expect(result.current.body).toContain('{{fullPrice}}');
    expect(result.current.body).toContain('{{bankName}}');
  });
  it('copies the current manual body and regenerates it on the next variable change', async () => {
    const { result } = setup();
    act(() => result.current.changeBody('수동 본문'));
    await act(async () => { await result.current.copyBody('maker-body'); });
    expect(copyMakerBody).toHaveBeenLastCalledWith('수동 본문', 'maker-body');
    expect(result.current.copyFeedback?.tone).toBe('ok');
    act(() => result.current.changeVariable('name', 'QA-새이름'));
    expect(result.current.body).toContain('QA-새이름');
    expect(result.current.body).not.toBe('수동 본문');
    expect(result.current.copyFeedback).toBeNull();
  });
  it('shows guidance on clipboard denial and ignores a delayed success after editing', async () => {
    const { result } = setup();
    jest.mocked(copyMakerBody).mockResolvedValueOnce(false);
    await act(async () => { await result.current.copyBody('maker-body'); });
    expect(result.current.copyFeedback).toMatchObject({ tone: 'err', text: '본문을 선택해 직접 복사해 주세요' });
    let finish!: (value: boolean) => void;
    jest.mocked(copyMakerBody).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = result.current.copyBody('maker-body'); });
    act(() => result.current.changeBody('다른 본문'));
    await act(async () => { finish(true); await pending; });
    expect(result.current.copyFeedback).toBeNull();
  });
  it('resets variables, region, year, body override and feedback on every template selection', async () => {
    const { result } = setup();
    act(() => result.current.changeVariable('name', 'QA-이름'));
    act(() => result.current.changeArea('QA-지역'));
    act(() => result.current.changeYear(String(new Date().getFullYear() + 1)));
    act(() => result.current.changeBody('override'));
    await act(async () => { await result.current.copyBody('maker-body'); });
    act(() => result.current.changeTemplate('custom'));
    expect(result.current.body).toBe('');
    expect(result.current.year).toBe(new Date().getFullYear());
    expect(result.current.area).toBe('');
    expect(result.current.values).toEqual({});
    expect(result.current.copyFeedback).toBeNull();
    act(() => result.current.changeBody('x'.repeat(2100)));
    expect(result.current.body).toHaveLength(2000);
  });
});
