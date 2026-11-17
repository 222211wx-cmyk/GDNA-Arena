FROM node:22-slim
RUN npm install -g pnpm@10
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..." --filter "@workspace/gdna-arena..."
RUN pnpm --filter @workspace/api-server build
RUN NODE_ENV=production BASE_PATH=/ pnpm --filter @workspace/gdna-arena build
ENV NODE_ENV=production
ENV WEB_DIST_DIR=/app/artifacts/gdna-arena/dist/public
EXPOSE 8080
CMD ["pnpm", "--filter", "@workspace/api-server", "start"]
