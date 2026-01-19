# Work Plan: Gemini Chat UI Redesign

## Overview
Transform the Gemini chat interface from bubble-based messages to a ChatGPT-style rendering system with full-width assistant responses, enhanced code blocks, and improved UX.

## Requirements Summary

| Requirement | Implementation |
|-------------|----------------|
| User messages | Keep bubble (right-aligned, primary color) |
| Assistant messages | Full-width, no bubble, app icon on left |
| Code blocks | Syntax highlighting + copy button |
| Chat input focus | Persist focus after message submission |

## Tasks

### Task 1: Install Dependencies
**Parallelizable**: NO (must complete before other tasks)

**Files**: `frontend/package.json`

**Actions**:
```bash
cd frontend && npm install react-syntax-highlighter && npm install -D @types/react-syntax-highlighter
```

**Verification**: 
- `package.json` contains `react-syntax-highlighter`
- `npm run build` succeeds

---

### Task 2: Fix ChatInput Focus Persistence
**Parallelizable**: YES (with Tasks 3, 4)

**File**: `frontend/src/app/(components)/chat/ChatInput.tsx`

**Current Issue**: TextField loses focus after `handleSubmit()` clears the value.

**Changes**:
1. Import `useRef` from React
2. Create `inputRef = useRef<HTMLInputElement>(null)`
3. Add `inputRef` prop to TextField
4. Call `inputRef.current?.focus()` after `setValue("")` in `handleSubmit`

**Code Change**:
```tsx
// Add to imports
import { useState, KeyboardEvent, useRef } from "react";

// Add ref inside component
const inputRef = useRef<HTMLInputElement>(null);

// Modify handleSubmit
const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed && !disabled) {
        onSubmit(trimmed);
        setValue("");
        // Re-focus after clearing
        setTimeout(() => inputRef.current?.focus(), 0);
    }
};

// Add to TextField
<TextField
    inputRef={inputRef}
    // ... rest of props
/>
```

**Verification**: 
- Type message, press Enter
- Input should remain focused after submission

---

### Task 3: Create CodeBlock Component
**Parallelizable**: YES (with Tasks 2, 4)

**File**: `frontend/src/app/(components)/chat/CodeBlock.tsx` (NEW)

**Description**: Enhanced code block with syntax highlighting and copy button.

**Implementation**:
```tsx
"use client";

import { useState } from "react";
import { Box, IconButton, Typography, Tooltip } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeBlockProps {
    children: string;
    language?: string;
}

export function CodeBlock({ children, language = "text" }: CodeBlockProps) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(children);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Box sx={{ position: "relative", my: 2 }}>
            {/* Header with language + copy button */}
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    bgcolor: "grey.800",
                    px: 2,
                    py: 0.5,
                    borderTopLeftRadius: 8,
                    borderTopRightRadius: 8,
                }}
            >
                <Typography variant="caption" sx={{ color: "grey.400" }}>
                    {language}
                </Typography>
                <Tooltip title={copied ? "Copied!" : "Copy code"}>
                    <IconButton size="small" onClick={handleCopy} sx={{ color: "grey.400" }}>
                        {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                    </IconButton>
                </Tooltip>
            </Box>
            
            {/* Syntax highlighted code */}
            <SyntaxHighlighter
                language={language}
                style={oneDark}
                customStyle={{
                    margin: 0,
                    borderTopLeftRadius: 0,
                    borderTopRightRadius: 0,
                    borderBottomLeftRadius: 8,
                    borderBottomRightRadius: 8,
                }}
            >
                {children}
            </SyntaxHighlighter>
        </Box>
    );
}
```

**Verification**:
- Code blocks display with syntax highlighting
- Copy button copies code to clipboard
- "Copied!" feedback appears

---

### Task 4: Create AssistantMessage Component
**Parallelizable**: YES (with Tasks 2, 3)

**File**: `frontend/src/app/(components)/chat/AssistantMessage.tsx` (NEW)

**Description**: Full-width message with app icon on left, ChatGPT-style layout.

**Implementation**:
```tsx
"use client";

import { Box, Avatar } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { MarkdownContent } from "./MarkdownContent";
import type { ChatMessage } from "@/app/hooks/useChatStream";

interface AssistantMessageProps {
    message: ChatMessage;
}

export function AssistantMessage({ message }: AssistantMessageProps) {
    return (
        <Box
            sx={{
                display: "flex",
                gap: 2,
                mb: 3,
                width: "100%",
            }}
        >
            {/* App Icon Avatar */}
            <Avatar
                src="/assets/icon-72.png"
                alt="AI"
                sx={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                }}
            />
            
            {/* Full-width content */}
            <Box sx={{ flex: 1, minWidth: 0 }}>
                <MarkdownContent>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            code: ({ node, inline, className, children, ...props }) => {
                                const match = /language-(\w+)/.exec(className || "");
                                const language = match ? match[1] : "";
                                
                                if (!inline && language) {
                                    return (
                                        <CodeBlock language={language}>
                                            {String(children).replace(/\n$/, "")}
                                        </CodeBlock>
                                    );
                                }
                                
                                return (
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                );
                            },
                            table: ({ children }) => (
                                <div className="table-wrapper">
                                    <table>{children}</table>
                                </div>
                            ),
                        }}
                    >
                        {message.content}
                    </ReactMarkdown>
                    
                    {/* Streaming cursor */}
                    {message.isStreaming && (
                        <Box
                            component="span"
                            sx={{
                                display: "inline-block",
                                width: 8,
                                height: 16,
                                bgcolor: "text.primary",
                                ml: 0.5,
                                animation: "blink 1s infinite",
                                "@keyframes blink": {
                                    "0%, 50%": { opacity: 1 },
                                    "51%, 100%": { opacity: 0 },
                                },
                            }}
                        />
                    )}
                </MarkdownContent>
            </Box>
        </Box>
    );
}
```

**Verification**:
- Assistant messages show app icon on left
- Content uses full width (no maxWidth restriction)
- No bubble/Paper wrapping
- Streaming cursor works

---

### Task 5: Extract MarkdownContent as Separate Component
**Parallelizable**: NO (depends on Task 3)

**File**: `frontend/src/app/(components)/chat/MarkdownContent.tsx` (NEW)

**Description**: Extract the styled MarkdownContent from ChatFullscreen for reuse.

**Actions**:
1. Create new file with the existing `MarkdownContent` styled component
2. Export it for use in AssistantMessage
3. Adjust styling for full-width context (remove bubble constraints)

---

### Task 6: Refactor ChatFullscreen to Use New Components
**Parallelizable**: NO (depends on Tasks 3, 4, 5)

**File**: `frontend/src/app/(components)/chat/ChatFullscreen.tsx`

**Changes**:
1. Import `AssistantMessage` component
2. Keep `UserMessage` (current bubble style, just rename from `MessageBubble`)
3. Render different components based on message role
4. Remove the old `MessageBubble` component

**Code Change in render**:
```tsx
{messages.map((msg, idx) => (
    msg.role === "user" 
        ? <UserMessage key={idx} message={msg} />
        : <AssistantMessage key={idx} message={msg} />
))}
```

**UserMessage** keeps the current bubble styling:
```tsx
function UserMessage({ message }: { message: ChatMessage }) {
    return (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <Paper
                elevation={0}
                sx={{
                    maxWidth: "80%",
                    px: 2,
                    py: 1.5,
                    borderRadius: 2,
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                }}
            >
                <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {message.content}
                </Typography>
            </Paper>
        </Box>
    );
}
```

**Verification**:
- User messages: Right-aligned bubbles (unchanged)
- Assistant messages: Full-width with icon (new style)
- Build passes with no errors

---

### Task 7: Final Verification & Testing
**Parallelizable**: NO (final step)

**Actions**:
1. Run `npm run build` - must pass
2. Run `npm run lint` - check for issues
3. Manual test all features:
   - [ ] User messages show in bubbles (right-aligned)
   - [ ] Assistant messages show full-width with icon
   - [ ] Code blocks have syntax highlighting
   - [ ] Copy button works
   - [ ] Chat input stays focused after submission
   - [ ] Streaming cursor displays during response
   - [ ] Tables render correctly
   - [ ] Mobile responsive

---

## File Summary

| File | Action |
|------|--------|
| `frontend/package.json` | Add react-syntax-highlighter |
| `frontend/src/app/(components)/chat/ChatInput.tsx` | Add focus persistence |
| `frontend/src/app/(components)/chat/CodeBlock.tsx` | NEW - Syntax highlighting component |
| `frontend/src/app/(components)/chat/AssistantMessage.tsx` | NEW - Full-width message component |
| `frontend/src/app/(components)/chat/MarkdownContent.tsx` | NEW - Extracted styled component |
| `frontend/src/app/(components)/chat/ChatFullscreen.tsx` | Refactor to use new components |

## Dependencies

```
react-syntax-highlighter: ^15.6.1
@types/react-syntax-highlighter: ^15.5.13 (devDependency)
```

## Execution Order

```
Task 1 (deps)
    ↓
Tasks 2, 3, 4, 5 (parallel - independent components)
    ↓
Task 6 (integrate)
    ↓
Task 7 (verify)
```
