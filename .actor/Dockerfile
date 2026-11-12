# Build TypeScript with dev dependencies, then keep only runtime dependencies.
FROM apify/actor-node:20 AS builder
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
    && npm run build \
    && npm prune --omit=dev --ignore-scripts

FROM apify/actor-node:20
# The base image already has node_modules (including an older `crawlee`).
# COPY into that directory merges rather than replaces, which leaves a
# leftover crawlee package that crashes Actor.init with a version mismatch.
RUN rm -rf /usr/src/app/node_modules
COPY --from=builder /usr/src/app/package.json /usr/src/app/package-lock.json ./
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
ENV NODE_ENV=production
CMD ["node", "dist/actor.js"]
