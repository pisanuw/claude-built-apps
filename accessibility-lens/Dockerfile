# Multi-stage build: install, build client + server, then run a slim image.
FROM node:22-slim AS build
WORKDIR /app

# Install all workspace deps using the lockfile for reproducibility.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci

# Build both workspaces.
COPY . .
RUN npm run build

# Prune dev dependencies for the runtime image.
RUN npm prune --omit=dev

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy only what the server needs at runtime.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist

EXPOSE 3000
WORKDIR /app/server
CMD ["node", "dist/index.js"]
