FROM node:20
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install
COPY . .
RUN pnpm install --no-frozen-lockfile
RUN if [ -d artifacts/gdna-arena ]; then pnpm --filter @workspace/gdna-arena build; else echo "WARNING: artifacts/gdna-arena missing, no frontend built"; fi
RUN pnpm --filter @workspace/api-server build
ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh", "-c", "pnpm --filter @workspace/api-server start"]
