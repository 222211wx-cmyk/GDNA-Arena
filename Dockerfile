FROM node:22-slim
RUN npm install -g pnpm@10
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..."
RUN pnpm --filter @workspace/api-server build
ENV NODE_ENV=production
EXPOSE 8080
CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
