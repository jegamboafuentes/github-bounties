# GitHub Bounties web — Cloud Run (PORT=8080). Does not bake secrets.
FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
# server.js serves `<its directory>/public`, scanned once at boot. Standalone
# output does not include public/ unless `npm run build` staged it beside
# server.js. Copy public/ AFTER standalone, at the image root, so a flat
# server.js always sees /og.png (a missing file is the prerendered HTML 404).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 8080
CMD ["node", "server.js"]
