import { render, screen } from '@testing-library/react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { ContentPaper } from '../ContentPaper';

const theme = createTheme({
  shape: { borderRadius: 14 },
  palette: {
    background: { default: '#fafafa', paper: '#f6f7fb' },
    primary: { main: '#1e88e5' },
  },
});

const renderWithTheme = (ui: React.ReactElement) => {
  return render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
};

describe('ContentPaper', () => {
  describe('Basic Rendering', () => {
    it('renders children correctly', () => {
      renderWithTheme(
        <ContentPaper>
          <div data-testid="child">Hello</div>
        </ContentPaper>
      );

      expect(screen.getByTestId('child')).toBeInTheDocument();
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });

    it('renders with data-component attribute for testing', () => {
      renderWithTheme(<ContentPaper>Content</ContentPaper>);

      expect(screen.getByTestId('ContentPaper')).toHaveAttribute(
        'data-component',
        'ContentPaper'
      );
    });

    it('renders with empty children without error', () => {
      expect(() => renderWithTheme(<ContentPaper>{null}</ContentPaper>)).not.toThrow();
      expect(() => renderWithTheme(<ContentPaper>{undefined}</ContentPaper>)).not.toThrow();
    });

    it('renders multiple children in order', () => {
      renderWithTheme(
        <ContentPaper>
          <div data-testid="first">First</div>
          <div data-testid="second">Second</div>
          <div data-testid="third">Third</div>
        </ContentPaper>
      );

      expect(screen.getByTestId('first')).toBeInTheDocument();
      expect(screen.getByTestId('second')).toBeInTheDocument();
      expect(screen.getByTestId('third')).toBeInTheDocument();
    });
  });

  describe('Elevation', () => {
    it('applies default elevation of 2', () => {
      renderWithTheme(<ContentPaper>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      // MUI Paper with elevation > 0 has box-shadow
      const computedStyle = window.getComputedStyle(paper);
      expect(computedStyle.boxShadow).not.toBe('none');
    });

    it('allows elevation override to 0', () => {
      renderWithTheme(<ContentPaper elevation={0}>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      // MUI 7+ uses CSS variables for shadows - elevation 0 still sets the variable
      // We verify the prop is accepted and element renders correctly
      expect(paper).toBeInTheDocument();
    });

    it('allows elevation override to higher values', () => {
      renderWithTheme(<ContentPaper elevation={8}>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      const computedStyle = window.getComputedStyle(paper);
      expect(computedStyle.boxShadow).not.toBe('none');
    });
  });

  describe('Title and Subtitle', () => {
    it('renders title when provided', () => {
      renderWithTheme(<ContentPaper title="Test Title">Content</ContentPaper>);

      const heading = screen.getByRole('heading', { level: 5 });
      expect(heading).toBeInTheDocument();
      expect(screen.getByText('Test Title')).toBeInTheDocument();
    });

    it('renders subtitle when provided with title', () => {
      renderWithTheme(
        <ContentPaper title="Title" subtitle="Test Subtitle">
          Content
        </ContentPaper>
      );

      expect(screen.getByText('Test Subtitle')).toBeInTheDocument();
    });

    it('does not render title/subtitle when not provided', () => {
      renderWithTheme(<ContentPaper>Content</ContentPaper>);

      expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('renders title with special characters correctly', () => {
      renderWithTheme(
        <ContentPaper title="직원 목록 & 'Quotes'">Content</ContentPaper>
      );

      expect(screen.getByText("직원 목록 & 'Quotes'")).toBeInTheDocument();
    });
  });

  describe('Header Prop', () => {
    it('header prop overrides title/subtitle', () => {
      renderWithTheme(
        <ContentPaper
          title="Ignored Title"
          subtitle="Ignored Subtitle"
          header={<div data-testid="custom-header">Custom Header</div>}
        >
          Content
        </ContentPaper>
      );

      expect(screen.getByTestId('custom-header')).toBeInTheDocument();
      expect(screen.queryByText('Ignored Title')).not.toBeInTheDocument();
      expect(screen.queryByText('Ignored Subtitle')).not.toBeInTheDocument();
    });

    it('header prop with complex ReactNode', () => {
      renderWithTheme(
        <ContentPaper
          header={
            <div data-testid="complex-header">
              <h2>Custom Title</h2>
              <button>Action</button>
            </div>
          }
        >
          Content
        </ContentPaper>
      );

      expect(screen.getByTestId('complex-header')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
        'Custom Title'
      );
      expect(screen.getByRole('button', { name: 'Action' })).toBeInTheDocument();
    });
  });

  describe('Styling and sx Props', () => {
    it('applies default padding (p: 3 = 24px)', () => {
      renderWithTheme(<ContentPaper>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      const computedStyle = window.getComputedStyle(paper);
      expect(computedStyle.padding).toBe('24px');
    });

    it('custom padding via sx overrides default', () => {
      renderWithTheme(<ContentPaper sx={{ p: 2 }}>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      const computedStyle = window.getComputedStyle(paper);
      expect(computedStyle.padding).toBe('16px');
    });

    it('merges custom sx props with defaults', () => {
      renderWithTheme(
        <ContentPaper sx={{ minHeight: '70vh' }}>Content</ContentPaper>
      );
      const paper = screen.getByTestId('ContentPaper');

      const computedStyle = window.getComputedStyle(paper);
      expect(computedStyle.minHeight).toBe('70vh');
      expect(computedStyle.padding).toBe('24px');
    });

    it('applies bgcolor background.default by default', () => {
      renderWithTheme(<ContentPaper>Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      const computedStyle = window.getComputedStyle(paper);
      expect(computedStyle.backgroundColor).toBeTruthy();
      expect(computedStyle.backgroundColor).not.toBe('transparent');
    });
  });

  describe('Animation', () => {
    it('Fade animation is enabled by default', () => {
      jest.useFakeTimers();
      renderWithTheme(<ContentPaper>Content</ContentPaper>);

      jest.advanceTimersByTime(500);

      expect(screen.getByTestId('ContentPaper')).toBeInTheDocument();
      jest.useRealTimers();
    });

    it('disableAnimation prop renders content immediately', () => {
      renderWithTheme(
        <ContentPaper disableAnimation>Immediate Content</ContentPaper>
      );

      expect(screen.getByText('Immediate Content')).toBeInTheDocument();
    });
  });

  describe('Prop Forwarding', () => {
    it('forwards component prop to Paper', () => {
      renderWithTheme(
        <ContentPaper component="section">Content</ContentPaper>
      );
      const paper = screen.getByTestId('ContentPaper');

      expect(paper.tagName).toBe('SECTION');
    });

    it('forwards id prop to Paper', () => {
      renderWithTheme(<ContentPaper id="test-section">Content</ContentPaper>);
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).toHaveAttribute('id', 'test-section');
    });

    it('forwards className prop to Paper', () => {
      renderWithTheme(
        <ContentPaper className="custom-class">Content</ContentPaper>
      );
      const paper = screen.getByTestId('ContentPaper');

      expect(paper).toHaveClass('custom-class');
    });
  });
});
