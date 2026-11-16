FROM node:20
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install
COPY . .
RUN pnpm --filter @workspace/api-server build
ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh", "-c", "pnpm --filter @workspace/api-server start"]
