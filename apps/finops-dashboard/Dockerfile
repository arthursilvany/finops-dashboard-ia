# Multi-stage build for FinOps Dashboard (Next.js 16)

# Stage 1: Build dependencies and application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

# Install dependencies.
# No `|| npm install` fallback: that would hide a failing `npm ci` and resolve
# fresh versions instead, so the image could silently stop matching the lockfile.
RUN npm ci --prefer-offline --no-audit

# Copy source code
COPY . .

# Build Next.js application
RUN npm run build

# Stage 2: Runtime (minimal image)
FROM node:22-alpine

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy package files from builder
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

# Install production dependencies only (see note above on the missing fallback)
RUN npm ci --prefer-offline --no-audit --omit=dev

# Copy built application and public assets from builder
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/tsconfig.json ./

# Expose port
EXPOSE 3000

# Health check.
# Must target /api/health: it is the only path left anonymous by the auth
# layer, so any other path answers with a redirect to the login page once
# Easy Auth is enabled.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode);})" || exit 1

# Start application
CMD ["npm", "start"]
