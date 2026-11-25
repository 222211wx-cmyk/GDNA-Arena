FROM node:20
WORKDIR /app
# bsdtar (libarchive) extracts 7z and RAR for QAISYPRO
RUN apt-get update && apt-get install -y --no-install-recommends libarchive-tools && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
RUN corepack enable && corepack prepare pnpm@latest --activate && pnpm install
COPY . .
RUN pnpm --filter @workspace/api-server build
ENV NODE_ENV=production
EXPOSE 8080
CMD ["sh", "-c", "pnpm --filter @workspace/api-server start"]
