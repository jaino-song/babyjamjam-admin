# Design Language & Conventions

This document describes the design patterns, conventions, and best practices used throughout the BabyJamJam Staff frontend application.

## Table of Contents
- [Theme & Colors](#theme--colors)
- [Typography](#typography)
- [Layout System](#layout-system)
- [Page Structure](#page-structure)
- [Component Patterns](#component-patterns)
- [Spacing System](#spacing-system)
- [Animation](#animation)
- [Form Components](#form-components)
- [Data Display Components](#data-display-components)
- [Navigation Patterns](#navigation-patterns)
- [Naming Conventions](#naming-conventions)

---

## Theme & Colors

### MUI Theme Configuration
Located in: `src/app/(components)/mui-theme-provider.tsx`

```typescript
const theme = createTheme({
  typography: {
    fontFamily: "var(--font-pretendard), 'Helvetica Neue', Arial, sans-serif",
  },
  palette: {
    background: {
      default: "#ffffff",  // White - used for content areas
      paper: "#f6f7fb",    // Light gray - used for page backgrounds
    },
    primary: {
      main: "#1e88e5",     // Blue - primary actions, titles
    },
    secondary: {
      main: "#1b5e20",     // Green - success states
    },
  },
  shape: { borderRadius: 14 },
});
```

### Color Usage Guidelines

| Context | Color | Usage |
|---------|-------|-------|
| Page background | `background.paper` (#f6f7fb) | AnimatedContainer, page wrappers |
| Content cards | `background.default` (#ffffff) | Paper, Card components |
| Primary actions | `primary.main` (#1e88e5) | Buttons, titles, active states |
| Secondary/Success | `secondary.main` (#1b5e20) | Success indicators |
| Text primary | `text.primary` | Main content text |
| Text secondary | `text.secondary` | Subtitles, labels |

### Status Colors (Chips)
```typescript
// Common status chip colors
"완료" → color="success" (green)
"대기" → color="warning" (orange/yellow)
"거부" → color="error" (red)
"전체" → color="default" (gray)
```

---

## Typography

### Font Family
- **Primary**: Pretendard (Korean-optimized variable font)
- **Fallback**: 'Helvetica Neue', Arial, sans-serif

### Typography Scale

| Variant | Usage | Style |
|---------|-------|-------|
| `h5` | Page/Section titles | `fontWeight: 700`, `color: "primary.main"` |
| `h6` | Card titles, stats | `fontWeight: 700` |
| `subtitle2` | Banner subtitles | `opacity: 0.9`, `fontSize: "1rem"` |
| `body1` | Primary content | `fontWeight: 600` for labels |
| `body2` | Descriptions, subtitles | `color: "text.secondary"` |
| `caption` | Small labels | - |

### Title Pattern
```tsx
<Typography variant="h5" color="primary.main" fontWeight={700} gutterBottom>
  {title}
</Typography>
<Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
  {subtitle}
</Typography>
```

---

## Layout System

### Root Layout Structure
Located in: `src/app/layout.tsx`

```
<body>
  └─ <EmotionRegistry>
      └─ <ThemeProvider>
          └─ <QueryProvider>
              └─ <LocaleProvider>
                  └─ <UserProvider>
                      ├─ <ConditionalHeader />
                      └─ <AnimatedContainer>
                          └─ <Box component="main" sx={{ m: 1, flexGrow: 1, width: "100%" }}>
                              {children}
                          </Box>
                      </AnimatedContainer>
```

### Key Layout Properties
```typescript
// main-content Box (layout.tsx)
sx={{ m: 1, flexGrow: 1, width: "100%" }}

// AnimatedContainer
sx={{
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'center',
  flexGrow: 1,
  bgcolor: 'background.paper',
}}
```

---

## Page Structure

### ⚠️ MANDATORY: Box Wrapper Pattern
**All pages must use this wrapper pattern** for consistent margins, padding, and layout across the application.

```tsx
// src/app/[page]/page.tsx
import { Box } from "@mui/material";

export default async function PageName() {
  return (
    <Box sx={{ bgcolor: "background.paper" }}>
      <Box
        component="section"
        data-component="page-name"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          mx: "auto",
        }}
      >
        <PageContent />
      </Box>
    </Box>
  );
}
```

### Key Elements
1. **Outer Box**: `bgcolor: "background.paper"` - ensures consistent page background
2. **Inner Box**: Responsive padding wrapper with semantic `component="section"` and `data-component` attribute
3. **Content**: The actual page content (forms, tables, etc.)

### With Loading Delay (for animation sync)
Use for pages with form components that benefit from loading animation timing.

```tsx
import { Box } from "@mui/material";
import { delay } from "@/app/lib/delay";

export default async function PageName() {
  await delay(300);
  return (
    <Box sx={{ bgcolor: "background.paper" }}>
      <Box
        component="section"
        data-component="page-name"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          mx: "auto",
        }}
      >
        <FormComponent />
      </Box>
    </Box>
  );
}
```

### Exception: Container-based Pages
Settings and other tabbed/constrained pages may use MUI Container instead.

```tsx
import { Container } from "@mui/material";

export default function SettingsPage() {
  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <TabContent />
    </Container>
  );
}
```

### Responsive Padding Scale
```typescript
sx={{
  px: { xs: 2, sm: 3, md: 6 },  // Horizontal: 16px → 24px → 48px
  py: { xs: 3, sm: 4 },         // Vertical: 24px → 32px
}}
```

---

## Component Patterns

### ComponentContainer (Reusable Wrapper)
Located in: `src/app/(components)/root/ComponentContainer.tsx`

Use for list/table pages that need consistent styling.

```tsx
<Paper
  elevation={2}
  data-component="component-container"
  sx={{
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    p: 3,
    flexGrow: 1,
    width: "100%",
    minHeight: "70vh",
    bgcolor: "background.default"
  }}
>
  <Fade in appear timeout={500}>
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Typography variant="h5" color="primary.main" fontWeight={700} gutterBottom>
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {subtitle}
      </Typography>
      {children}
    </Box>
  </Fade>
</Paper>
```

### Form Paper Container
Use for form pages (similar structure to ComponentContainer).

```tsx
<Paper
  elevation={2}
  data-component="form-name"
  sx={{
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    p: 3,
    flexGrow: 1,
    width: "100%",
    bgcolor: "background.default",
  }}
>
  {/* Content */}
</Paper>
```

### Card Component
Use for dashboard stats and info cards.

```tsx
<Card
  elevation={2}
  sx={{
    py: 2.5,
    px: 3,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: 2,
    bgcolor: "background.default"
  }}
>
  {/* Content */}
</Card>
```

---

## Spacing System

### MUI Spacing Unit
1 unit = 8px

### Common Spacing Values

| Value | Pixels | Usage |
|-------|--------|-------|
| 0.5 | 4px | Tight spacing |
| 1 | 8px | Icon gaps, margins |
| 1.5 | 12px | Button spacing, small gaps |
| 2 | 16px | Section spacing |
| 2.5 | 20px | Card padding |
| 3 | 24px | Container padding, major sections |
| 4 | 32px | Large spacing |

### Standard Component Spacing
```typescript
// Container padding
p: 3  // 24px all sides

// Card padding
py: 2.5, px: 3  // 20px vertical, 24px horizontal

// Title margin bottom
gutterBottom  // or mb: 0.5-1

// Subtitle margin bottom
mb: 3  // 24px before content

// Button spacing in Stack
spacing: 1.5  // 12px gap
```

---

## Animation

### AnimatedContainer (Page Transitions)
Located in: `src/app/(components)/root/AnimatedContainer.tsx`

```tsx
<Box
  component={motion.article}
  key={pathname}  // Triggers animation on route change
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 1 }}
>
  {children}
</Box>
```

### Fade-in Animation
Use `<Fade>` for content appearance within pages.

```tsx
<Fade in appear timeout={500}>
  <Box>
    {/* Content */}
  </Box>
</Fade>
```

---

## Form Components

### Dialog Pattern
Located in: `src/app/(components)/[feature]/[Feature]FormDialog.tsx`

```tsx
<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
  <DialogTitle>
    {isEditMode ? t(locale, "edit-title") : t(locale, "create-title")}
  </DialogTitle>
  <DialogContent>
    {/* Form fields */}
  </DialogContent>
  <DialogActions>
    <Button onClick={onClose}>{t(locale, "common.cancel")}</Button>
    <Button variant="contained" onClick={handleSubmit}>
      {t(locale, "common.save")}
    </Button>
  </DialogActions>
</Dialog>
```

### Form Field Layout
Use Grid for form layouts.

```tsx
<Grid container spacing={2}>
  <Grid size={{ xs: 12, sm: 6 }}>
    <TextField fullWidth label="Field 1" />
  </Grid>
  <Grid size={{ xs: 12, sm: 6 }}>
    <TextField fullWidth label="Field 2" />
  </Grid>
</Grid>
```

### Autocomplete Pattern
For searchable select fields with Korean 초성 support.

```tsx
<Autocomplete
  options={options}
  getOptionLabel={(option) => option.name}
  filterOptions={(options, { inputValue }) => {
    // Custom filter with 초성 matching
  }}
  renderInput={(params) => (
    <TextField {...params} label="Label" required />
  )}
/>
```

---

## Data Display Components

### Table Pattern
Located in: `src/app/(components)/[feature]/[Feature]Table.tsx`

```tsx
<ComponentContainer textJSON="table-name">
  <Box>
    {/* Toolbar */}
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-around" }}>
      <IconButton><Search /></IconButton>
      <IconButton><Filter /></IconButton>
      <IconButton><Plus /></IconButton>
    </Box>

    <Divider />

    {/* Table */}
    <TableContainer>
      <Table sx={{ tableLayout: "fixed", width: "100%" }}>
        <TableHead>
          <TableRow>
            <TableCell align="center" sx={{ fontWeight: 500, color: "rgba(0, 0, 0, 0.6)" }}>
              Column Header
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {data.map((item) => (
            <TableRow key={item.id} hover>
              <TableCell align="center">{item.value}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>

    {/* Pagination */}
    <TablePagination
      component="div"
      count={total}
      rowsPerPage={rowsPerPage}
      page={page}
      onPageChange={handleChangePage}
    />
  </Box>
</ComponentContainer>
```

### Status Chip Pattern
```tsx
const getStatusChip = (status: string) => {
  const colorMap: Record<string, "success" | "warning" | "error" | "default"> = {
    "완료": "success",
    "대기": "warning",
    "거부": "error",
  };
  return <Chip label={status} color={colorMap[status] || "default"} size="small" />;
};
```

---

## Navigation Patterns

### Tab Navigation (MsgNav Pattern)
Located in: `src/app/(components)/messages/MsgNav.tsx`

```tsx
<Paper
  elevation={2}
  sx={{
    borderRadius: "20px 20px 0 0",
    overflow: "hidden",
    bgcolor: "background.default",
  }}
>
  <Stack direction="row" sx={{ flexWrap: "wrap" }}>
    {navButtons.map((button) => (
      <Button
        key={button.id}
        component={Link}
        href={button.href}
        variant={pathname === button.href ? "contained" : "outlined"}
        sx={{
          borderRadius: 0,
          border: "none",
          textTransform: "none",
          flexGrow: 1,
          py: 1.5,
          minWidth: "20%",
        }}
      >
        {button.label}
      </Button>
    ))}
  </Stack>
</Paper>
```

### IconButton Links
```tsx
<IconButton
  LinkComponent={Link}
  href="/target-path"
  sx={{ color: "primary.main" }}
>
  <Plus size={30} strokeWidth={2} />
</IconButton>
```

---

## Naming Conventions

### data-component Attribute
Every significant component should have a `data-component` attribute for debugging and testing.

```tsx
<Box data-component="component-name">
<Paper data-component="form-name">
<Card data-component="stats-grid-card">
```

### Naming Pattern
- Use kebab-case: `data-component="contract-creation-form"`
- Be descriptive: `data-component="documents-list-toolbar"`
- Include parent context when nested: `data-component="stats-grid-item"`

### File Naming
- Components: `PascalCase.tsx` (e.g., `ClientsTable.tsx`)
- Hooks: `camelCase.ts` with `use` prefix (e.g., `useClients.ts`)
- Types: `types.ts` or `[feature].types.ts`
- Utils: `camelCase.ts` (e.g., `formatDate.ts`)

---

## Internationalization (i18n)

### Translation Pattern
```tsx
import { t } from "@/app/lib/i18n/translations";
import { useLocale } from "@/app/(components)/LocaleProvider";

const Component = () => {
  const locale = useLocale();

  return (
    <Typography>{t(locale, "namespace.key")}</Typography>
  );
};
```

### Translation File Structure
Located in: `src/texts/ko.json`, `src/texts/en.json`

```json
{
  "page-name": {
    "title": "페이지 제목",
    "subtitle": "페이지 설명"
  },
  "common": {
    "save": "저장",
    "cancel": "취소"
  }
}
```

---

## Icons

### Icon Libraries
- **Lucide React**: For general UI icons (`Search`, `Plus`, `Filter`)
- **MUI Icons**: For specific MUI-styled icons (`ArrowForwardIcon`, `SettingsIcon`)

### Icon Usage
```tsx
// Lucide React
import { Search, Filter, Plus } from "lucide-react";
<Search size={24} strokeWidth={2} />

// MUI Icons
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
<ArrowForwardIcon fontSize="small" />
```

---

## Best Practices

### 1. Always use `width: "100%"` for full-width components
The root layout ensures full width, but nested containers should explicitly set width.

### 2. Use `elevation={2}` for Paper/Card components
Consistent shadow depth across the app.

### 3. Use `bgcolor: "background.default"` for content containers
Maintains contrast with the page background.

### 4. Responsive padding with breakpoints
```tsx
sx={{
  px: { xs: 2, sm: 3, md: 6 },
  py: { xs: 3, sm: 4 },
}}
```

### 5. Include loading states
```tsx
{isLoading ? (
  <CircularProgress />
) : error ? (
  <Alert severity="error">{error.message}</Alert>
) : (
  <Content />
)}
```

### 6. Use semantic HTML elements
```tsx
<Box component="section">
<Box component="main">
<Box component="article">
```
