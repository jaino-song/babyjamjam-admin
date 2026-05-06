FROM node:20-bookworm-slim

# Chromium runtime libs needed by Playwright (headless eformsign dispatch).
# Without these the browser launches but every page navigation crashes.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libwayland-client0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# pnpm workspace setup
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && pnpm install --frozen-lockfile --filter babyjamjam-staff-backend...

# Install Chromium for playwright-core. PLAYWRIGHT_BROWSERS_PATH=0 keeps the
# binary inside node_modules so it's bundled with the deploy image.
ENV PLAYWRIGHT_BROWSERS_PATH=0
RUN pnpm --dir backend exec playwright install chromium

COPY backend/ backend/

RUN pnpm --dir backend run build

ENV NODE_ENV=production
WORKDIR /app/backend
CMD ["node", "dist/main"]
