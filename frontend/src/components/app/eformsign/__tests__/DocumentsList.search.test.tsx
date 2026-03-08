import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { DocumentsList } from '../DocumentsList';
import type { EformsignDocumentView } from '@/lib/eformsign/types';

const mockUseEformsignDocumentsByType = jest.fn();
const mockUseEformsignAuth = jest.fn();
const mockUseLocale = jest.fn();

jest.mock('@/hooks/useEformsignDocuments', () => ({
  useEformsignDocumentsByType: (...args: unknown[]) => mockUseEformsignDocumentsByType(...args),
}));

jest.mock('@/hooks/useEformsignAuth', () => ({
  useEformsignAuth: () => mockUseEformsignAuth(),
}));

jest.mock('@/providers/LocaleProvider', () => ({
  useLocale: () => mockUseLocale(),
}));

jest.mock('../../root/ContentPaper', () => ({
  ContentPaper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const createMockDocument = (
  doc_id: string,
  customer_name: string | null,
  status: '대기' | '완료' | '거부' = '완료'
): EformsignDocumentView => ({
  id: doc_id,
  document_number: `DOC-${doc_id}`,
  template: { id: 'template-1', name: 'Test Template' },
  document_name: 'Test Document',
  creator: { recipient_type: '01', id: 'creator@test.com', name: 'Creator' },
  created_date: Date.now(),
  last_editor: { recipient_type: '01', id: 'editor@test.com', name: customer_name || 'Editor' },
  updated_date: Date.now(),
  current_status: {
    status_type: status === '완료' ? '003' : status === '거부' ? '061' : '060',
    status_doc_type: 'doc',
    status_doc_detail: 'detail',
    step_type: '05',
    step_index: '1',
    step_name: 'Step 1',
    step_recipients: customer_name ? [{ recipient_type: '01', name: customer_name }] : [],
    step_group: 1,
    expired_date: Date.now() + 86400000,
    _expired: false,
  },
  fields: [],
  next_status: [],
  previous_status: [],
  histories: [],
  recipients: [],
  detail_template_info: [],
} as unknown as EformsignDocumentView);

const openSearchField = () => {
  const searchIconButton = screen.getByRole('button', { name: /search/i });
  fireEvent.click(searchIconButton);
  return screen.getByPlaceholderText('이름 검색');
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocale.mockReturnValue('ko');
  mockUseEformsignAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
  mockUseEformsignDocumentsByType.mockReturnValue({
    data: { documents: [], total_rows: 0, limit: 100, skip: 0 },
    isLoading: false,
    error: null,
    isFetching: false,
  });
});

describe('DocumentsList Search Filtering Logic', () => {
  describe('given search term is empty or whitespace', () => {
    it('should return all documents when search term is empty', () => {
      const mockDocuments = [
        createMockDocument('doc-1', '홍길동'),
        createMockDocument('doc-2', '김철수'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      expect(screen.getByText('홍길동')).toBeInTheDocument();
      expect(screen.getByText('김철수')).toBeInTheDocument();
    });

    it('should return all documents when search term is whitespace only', () => {
      const mockDocuments = [
        createMockDocument('doc-1', '홍길동'),
        createMockDocument('doc-2', '김철수'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      const searchField = openSearchField();
      fireEvent.change(searchField, { target: { value: '   ' } });
      fireEvent.keyDown(searchField, { key: 'Enter' });

      expect(screen.getByText('홍길동')).toBeInTheDocument();
      expect(screen.getByText('김철수')).toBeInTheDocument();
    });
  });

  describe('given search term matches customer names', () => {
    it('should filter documents by exact customer name match', () => {
      const mockDocuments = [
        createMockDocument('doc-1', '홍길동'),
        createMockDocument('doc-2', '김철수'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      const searchField = openSearchField();
      fireEvent.change(searchField, { target: { value: '홍길동' } });
      fireEvent.keyDown(searchField, { key: 'Enter' });

      expect(screen.getByText('홍길동')).toBeInTheDocument();
      expect(screen.queryByText('김철수')).not.toBeInTheDocument();
    });

    it('should filter documents by partial customer name (substring)', () => {
      const mockDocuments = [
        createMockDocument('doc-1', '홍길동'),
        createMockDocument('doc-2', '홍길순'),
        createMockDocument('doc-3', '김철수'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 3, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      const searchField = openSearchField();
      fireEvent.change(searchField, { target: { value: '홍길' } });
      fireEvent.keyDown(searchField, { key: 'Enter' });

      expect(screen.getByText('홍길동')).toBeInTheDocument();
      expect(screen.getByText('홍길순')).toBeInTheDocument();
      expect(screen.queryByText('김철수')).not.toBeInTheDocument();
    });

    it('should perform case-insensitive search (English names)', () => {
      const mockDocuments = [
        createMockDocument('doc-1', 'John Doe'),
        createMockDocument('doc-2', 'Jane Smith'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      const searchField = openSearchField();
      fireEvent.change(searchField, { target: { value: 'john' } });
      fireEvent.keyDown(searchField, { key: 'Enter' });

      expect(screen.getByText('John Doe')).toBeInTheDocument();
      expect(screen.queryByText('Jane Smith')).not.toBeInTheDocument();
    });

    it('should trim search term before filtering', () => {
      const mockDocuments = [
        createMockDocument('doc-1', '홍길동'),
        createMockDocument('doc-2', '김철수'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      const searchField = openSearchField();
      fireEvent.change(searchField, { target: { value: '  홍길동  ' } });
      fireEvent.keyDown(searchField, { key: 'Enter' });

      expect(screen.getByText('홍길동')).toBeInTheDocument();
      expect(screen.queryByText('김철수')).not.toBeInTheDocument();
    });
  });

  describe('given edge cases', () => {
    it('should handle null customer_name safely (treat as empty string)', () => {
      const mockDocuments = [
        createMockDocument('doc-1', null),
        createMockDocument('doc-2', '홍길동'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      const searchField = openSearchField();
      fireEvent.change(searchField, { target: { value: '홍' } });
      fireEvent.keyDown(searchField, { key: 'Enter' });

      expect(screen.getByText('홍길동')).toBeInTheDocument();
    });

    it('should return empty array when no documents match search', () => {
      const mockDocuments = [
        createMockDocument('doc-1', '홍길동'),
        createMockDocument('doc-2', '김철수'),
      ];

      mockUseEformsignDocumentsByType.mockReturnValue({
        data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
        isLoading: false,
        error: null,
        isFetching: false,
      });

      render(<DocumentsList />);

      const searchField = openSearchField();
      fireEvent.change(searchField, { target: { value: '박영희' } });
      fireEvent.keyDown(searchField, { key: 'Enter' });

      expect(screen.queryByText('홍길동')).not.toBeInTheDocument();
      expect(screen.queryByText('김철수')).not.toBeInTheDocument();
      expect(screen.getByText('문서가 없습니다')).toBeInTheDocument();
    });
  });
});

describe('DocumentsList Search UI Rendering', () => {
  it('should show search icon initially (collapsed state)', () => {
    render(<DocumentsList />);

    const searchIconButton = screen.getByRole('button', { name: /search/i });
    expect(searchIconButton).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('이름 검색')).not.toBeInTheDocument();
  });

  it('should show TextField when search icon is clicked (expanded state)', () => {
    render(<DocumentsList />);

    const searchIconButton = screen.getByRole('button', { name: /search/i });
    fireEvent.click(searchIconButton);

    expect(screen.getByPlaceholderText('이름 검색')).toBeInTheDocument();
  });

  it('should hide TextField on blur when search input is empty', () => {
    render(<DocumentsList />);

    const searchField = openSearchField();
    expect(searchField).toBeInTheDocument();

    fireEvent.blur(searchField);

    expect(screen.queryByPlaceholderText('이름 검색')).not.toBeInTheDocument();
  });

  it('should keep TextField visible on blur when search input has value', () => {
    render(<DocumentsList />);

    const searchField = openSearchField();
    fireEvent.change(searchField, { target: { value: '홍길동' } });
    fireEvent.blur(searchField);

    expect(screen.getByPlaceholderText('이름 검색')).toBeInTheDocument();
  });
});

describe('DocumentsList Search Handlers', () => {
  it('should update searchInput state on TextField change', () => {
    render(<DocumentsList />);

    const searchField = openSearchField() as HTMLInputElement;
    fireEvent.change(searchField, { target: { value: '홍길동' } });

    expect(searchField.value).toBe('홍길동');
  });

  it('should trigger search on Enter key press', () => {
    const mockDocuments = [
      createMockDocument('doc-1', '홍길동'),
      createMockDocument('doc-2', '김철수'),
    ];

    mockUseEformsignDocumentsByType.mockReturnValue({
      data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
      isLoading: false,
      error: null,
      isFetching: false,
    });

    render(<DocumentsList />);

    const searchField = openSearchField();
    fireEvent.change(searchField, { target: { value: '홍길동' } });
    fireEvent.keyDown(searchField, { key: 'Enter' });

    expect(screen.getByText('홍길동')).toBeInTheDocument();
    expect(screen.queryByText('김철수')).not.toBeInTheDocument();
  });

  it('should trigger search on Enter key when expanded', () => {
    const mockDocuments = [
      createMockDocument('doc-1', '홍길동'),
      createMockDocument('doc-2', '김철수'),
    ];

    mockUseEformsignDocumentsByType.mockReturnValue({
      data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
      isLoading: false,
      error: null,
      isFetching: false,
    });

    render(<DocumentsList />);

    const searchField = openSearchField();
    fireEvent.change(searchField, { target: { value: '홍길동' } });
    fireEvent.keyDown(searchField, { key: 'Enter' });

    expect(screen.getByText('홍길동')).toBeInTheDocument();
    expect(screen.queryByText('김철수')).not.toBeInTheDocument();
  });

  it('should reset page to 0 when search is executed', () => {
    const mockDocuments = Array.from({ length: 10 }, (_, i) =>
      createMockDocument(`doc-${i}`, `고객${i}`)
    );

    mockUseEformsignDocumentsByType.mockReturnValue({
      data: { documents: mockDocuments, total_rows: 10, limit: 100, skip: 0 },
      isLoading: false,
      error: null,
      isFetching: false,
    });

    render(<DocumentsList />);

    const nextButton = screen.getByRole('button', { name: /next/i });
    fireEvent.click(nextButton);

    const searchField = openSearchField();
    fireEvent.change(searchField, { target: { value: '고객1' } });
    fireEvent.keyDown(searchField, { key: 'Enter' });

    expect(screen.getByText('고객1')).toBeInTheDocument();
    expect(nextButton).toBeDisabled();
  });
});

describe('DocumentsList Combined Filtering (Search + Status)', () => {
  it('should apply search filter on top of status-filtered documents', () => {
    const mockDocuments = [
      createMockDocument('doc-1', '홍길동', '완료'),
      createMockDocument('doc-2', '김철수', '완료'),
    ];

    mockUseEformsignDocumentsByType.mockReturnValue({
      data: { documents: mockDocuments, total_rows: 2, limit: 100, skip: 0 },
      isLoading: false,
      error: null,
      isFetching: false,
    });

    render(<DocumentsList />);

    const searchField = openSearchField();
    fireEvent.change(searchField, { target: { value: '홍길동' } });
    fireEvent.keyDown(searchField, { key: 'Enter' });

    expect(screen.getByText('홍길동')).toBeInTheDocument();
    expect(screen.queryByText('김철수')).not.toBeInTheDocument();
    expect(screen.getByText('전체')).toBeInTheDocument();
  });
});
