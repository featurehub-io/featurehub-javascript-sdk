.PHONY: image-backend image-tests start-backend start-backend-qa test-server test-server-tags test-server-qa test-server-qa-tags

image-backend:
	@echo "Building Docker image for backend with integrated frontend..."
	docker build -f Dockerfile.backend -t featurehub/js-sdk-backend:latest .

image-tests:
	@echo "Building Docker image for integration tests..."
	docker build -f Dockerfile.tests -t featurehub/js-sdk-tests:latest .

start-backend:
	@echo "Starting TypeScript backend example..."
	@export FEATUREHUB_ACCEPT_BAGGAGE=true && \
	export FEATUREHUB_EDGE_URL=http://localhost:8903/ && \
	export FEATUREHUB_CLIENT_API_KEY=5c57c0b8-9f60-4efa-aef7-d3203792e8a8/H1M3z7UpT0X0lZEfVZ6QHt5khxKRz6*9EwfXCw0Yx4UEiCAea5G && \
	pnpm --filter './examples/todo-backend-typescript' run start

start-backend-qa:
	@echo "Starting TypeScript backend example (QA mode)..."
	@export FEATUREHUB_ACCEPT_BAGGAGE=true && \
	pnpm --filter './examples/todo-backend-typescript' run start

# Test environment variables
TEST_BASE_ENV = export APP_SERVER_URL=http://localhost:8099 && export DEBUG=true
TEST_FULL_ENV = $(TEST_BASE_ENV) && \
	export FEATUREHUB_CLIENT_API_KEY=0d348e65-677a-4fe6-85f1-a1ab1581faa1/CGWXaO3Cey6yjSobQMxgjdKdzLdli5*ZqH81DhIYuKyuY1TIsYX && \
	export FEATUREHUB_EDGE_URL=http://localhost:8064 && \
	export FEATUREHUB_BASE_URL=http://localhost:8903

# Internal helper to run tests
_run-test:
	@$(TEST_ENV) && pnpm run build:js && pnpm run build:node && pnpm --filter './examples/todo-server-tests' run test $(if $(TAGS),-- --tags $(TAGS))

test-server:
	@echo "Running todo-server-tests (full integration)..."
	@$(MAKE) _run-test TEST_ENV="$(TEST_FULL_ENV)"

test-server-qa:
	@echo "Running todo-server-tests (QA mode - API only)..."
	@$(MAKE) _run-test TEST_ENV="$(TEST_BASE_ENV)"

# Usage: make test-server-tags TAGS=@smoke
test-server-tags:
	@echo "Running todo-server-tests (full integration) with tags: $(TAGS)"
	@$(MAKE) _run-test TEST_ENV="$(TEST_FULL_ENV)" TAGS="$(TAGS)"

# Usage: make test-server-qa-tags TAGS=@smoke  
test-server-qa-tags:
	@echo "Running todo-server-tests (QA mode) with tags: $(TAGS)"
	@$(MAKE) _run-test TEST_ENV="$(TEST_BASE_ENV)" TAGS="$(TAGS)"
