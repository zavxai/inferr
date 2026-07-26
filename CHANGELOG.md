# Changelog

All notable changes to the Inferr platform will be documented in this file.

## [v0.1.0] - 2026-07-26

### 🚀 Public Release Milestone

#### ☸️ Infrastructure & Deployment
- **Kubernetes Deployment Manifests**: Added full Kubernetes configuration files (`k8s/` and `kubernetes/`) supporting `Deployment`, `Service`, `Ingress`, `ConfigMap`, `Secret`, and `CronJob` workloads.
- **Minikube Support & Local Cluster Docs**: Created local cluster setup guides and architecture diagrams for containerized deployment.

#### 🤖 AI & Observability
- **Langfuse LLM Observability**: Integrated Langfuse for real-time RAG execution tracing, query rewrite monitoring, cost/token metrics, and prompt versioning.
- **OpenTelemetry (OTel) Integration**: Added Node SDK auto-instrumentation and OTLP trace exporter for system-wide HTTP and database query tracing.

#### 🔌 Model Context Protocol (MCP) Server
- **MCP Tool Suite**: Exposed platform actions (Tech Market reports, user interest management, article bookmarks) as standard MCP tools.
- **Stateless OAuth 2.1 Server**: Implemented OAuth 2.1 authorization server endpoints for secure agent integration.

#### ⚡ Reliability & Performance
- **API Load Test Suite**: Implemented `autocannon` load testing suite in `apps/api/test/load-test.ts` with `pnpm test:load` command.
- **Scraper Hardening**: Added exponential retry logic, execution audit logging, and missed-job catchup schedulers.
- **Article Retention**: Switched article retention from hard limits to 45-day age-based pruning.
