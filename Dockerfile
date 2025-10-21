# ================================
# STAGE 0: Setup Base Image
# ================================
FROM node:22.20-bullseye-slim AS base

# Install pnpm globally
RUN npm install -g pnpm@latest

# Set working directory
WORKDIR /app

# Enable pnpm
RUN corepack enable pnpm

# ================================
# STAGE 1: Install Dependencies
# ================================
FROM base AS deps

# Copy workspace configuration files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all package.json files for dependency resolution
COPY packages/js/package.json ./packages/js/
COPY packages/node/package.json ./packages/node/
COPY packages/react/package.json ./packages/react/
COPY packages/solid/package.json ./packages/solid/
COPY packages/tsconfig/package.json ./packages/tsconfig/

# Copy example package.json files
COPY examples/todo-server-tests/package.json ./examples/todo-server-tests/
COPY examples/todo-backend-typescript/package.json ./examples/todo-backend-typescript/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# ================================
# STAGE 2: Build Packages
# ================================
FROM base AS builder

# Copy the ENTIRE dependency layer including all node_modules
COPY --from=deps /app ./

# Copy all source code (this will overlay the existing structure)
COPY packages/ ./packages/
COPY examples/ ./examples/

# Build all packages (this recreates the original compile behavior)
RUN pnpm run build:packages

# Examples are not compiled in the image - they are consumer applications built in isolation
