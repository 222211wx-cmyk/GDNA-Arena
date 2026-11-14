FROM node:20-slim
RUN corepack enable pnpm
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server build
ENV NODE_ENV=production
EXPOSE 8080
CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
