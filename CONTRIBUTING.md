# Contributing to FeatureHub JavaScript SDK

Thank you for your interest in contributing to the FeatureHub JavaScript SDK! This guide will help you get started with development, testing, and contributing to the project.

## 📋 Prerequisites

- **Node.js**: v20.0.0 or higher
- **pnpm**: v10.12 or higher
- **Docker**: For building container images
- **Make**: For running development commands

## 🏗️ Project Structure

This is a monorepo containing multiple packages and examples:

```
├── packages/           # SDK Libraries (published to npm)
│   ├── js/            # Core JavaScript SDK
│   ├── node/          # Node.js-specific SDK
│   ├── react/         # React hooks and components
│   ├── solid/         # SolidJS bindings
│   └── tsconfig/      # Shared TypeScript configuration
├── examples/          # Example applications
│   ├── todo-backend-typescript/     # Express API server
│   ├── todo-frontend-react-typescript/ # React frontend
│   └── todo-server-tests/          # Integration tests
└── Makefile          # Development commands
```

## 🚀 Getting Started

### 1. Clone and Install

```bash
git clone https://github.com/featurehub-io/featurehub-javascript-sdk.git
cd featurehub-javascript-sdk
pnpm install
```

### 2. Build All Packages

```bash
pnpm run build:packages
# or
make image  # Build packages in Docker
```

## 🛠️ Development Commands

We use a Makefile to consolidate common development tasks:

### Building

```bash
make image                    # Build packages Docker image
make image-backend            # Build full-stack backend Docker image
```

### Running Examples

```bash
make start-backend            # Start TypeScript backend (full integration)
make start-backend-qa         # Start backend (QA mode, no FeatureHub)
```

### Testing

```bash
make test-server              # Run integration tests (full FeatureHub)
make test-server-qa           # Run API-only tests (no FeatureHub)
make test-server-tags TAGS=@smoke    # Run tests with specific tags
make test-server-qa-tags TAGS=@api   # Run QA tests with tags
```

### Package-Specific Commands

```bash
pnpm run build:js            # Build JS package only
pnpm run build:react         # Build React package only
pnpm run test:packages       # Test all packages
pnpm run lint                # Lint all code
pnpm run typecheck           # Type check all packages
```

## 🧪 Testing

### Unit Tests

Each package has its own test suite:

```bash
pnpm --filter './packages/js' run test
pnpm --filter './packages/react' run test
```

### Integration Tests

The `todo-server-tests` example provides end-to-end integration testing:

- **Full Integration**: Tests with FeatureHub server running
- **QA Mode**: Tests API endpoints only (faster, no external dependencies)

### Running the Full Test Suite

```bash
# Start the backend
make start-backend

# In another terminal, run integration tests
make test-server
```

## 🐳 Docker Development

The project includes optimized multi-stage Dockerfiles:

### Package Libraries Only

```bash
make image
```

### Full-Stack Application (Backend + Frontend)

```bash
make image-backend
docker run -p 8099:8099 featurehub/js-sdk-backend:latest
```

The backend serves both:

- **API endpoints**: `/todo/*`, `/health/liveness`
- **Static frontend**: React SPA with client-side routing

## 📝 Code Style and Quality

### Linting and Formatting

```bash
pnpm run lint          # Check for linting issues
pnpm run lint:fix      # Auto-fix linting issues
pnpm run format        # Check formatting
pnpm run format:fix    # Auto-fix formatting
```

### TypeScript

All packages use strict TypeScript configuration:

- Extends `@tsconfig/strictest`
- Shared configuration in `packages/tsconfig/`
- ESLint flat config for modern linting

## 🔧 Adding New Packages

1. Create package directory under `packages/`
2. Add package.json with workspace dependencies
3. Update root package.json scripts for building
4. Add to Docker builds if needed
5. Update this CONTRIBUTING.md

### Package Dependencies

- Use `workspace:*` for internal dependencies
- Use `catalog:` for shared external dependencies
- Follow semantic versioning

## 🎯 Working with Examples

### Backend Example (`todo-backend-typescript`)

- **Express 5.x** server with FeatureHub integration
- **Static file serving** for React frontend
- **Health checks** and proper error handling
- **Environment variables** for configuration

### Frontend Example (`todo-frontend-react-typescript`)

- **React + TypeScript** with Vite
- **Auto-generated API client** from OpenAPI spec
- **FeatureHub React hooks** for feature flags

### Integration Tests (`todo-server-tests`)

- **Cucumber/Gherkin** test scenarios
- **Environment-specific** configurations
- **Tag-based** test filtering

## 📦 Release Process

1. **Update versions**: Bump package versions appropriately
2. **Build packages**: `pnpm run build:packages`
3. **Run tests**: `pnpm run test`
4. **Lint code**: `pnpm run lint`
5. **Type check**: `pnpm run typecheck`
6. **Create PR**: Submit for review
7. **Release**: Maintainers handle npm publishing

## 🤝 Pull Request Guidelines

### Before Submitting

- [ ] Tests pass (`pnpm run test`)
- [ ] Linting passes (`pnpm run lint`)
- [ ] TypeScript compiles (`pnpm run typecheck`)
- [ ] Documentation updated if needed

### PR Description

- Clear description of changes
- Link to related issues
- Include test plan
- Note any breaking changes

### Review Process

- At least one maintainer review required
- CI checks must pass
- Documentation updates reviewed

## 🐛 Reporting Issues

When reporting bugs:

1. **Environment**: Node.js version, OS, browser (if applicable)
2. **Reproduction**: Minimal steps to reproduce
3. **Expected vs Actual**: What should happen vs what actually happens
4. **Logs**: Include relevant error messages/stack traces

## 💡 Feature Requests

For new features:

1. **Use case**: Describe the problem you're solving
2. **Proposed solution**: How you envision it working
3. **Alternatives**: Other approaches you considered
4. **Breaking changes**: Impact on existing APIs

## 📚 Additional Resources

- [FeatureHub Documentation](https://docs.featurehub.io)
- [JavaScript SDK Documentation](https://docs.featurehub.io/sdks/javascript)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [pnpm Workspace Guide](https://pnpm.io/workspaces)

## ❓ Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **GitHub Discussions**: Questions and community support
- **Documentation**: Check existing docs first
- **Examples**: Reference the example applications

---

Thank you for contributing to FeatureHub! 🚀
