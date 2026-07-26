# Kubernetes Monitoring & Logging Architecture

This guide covers setting up and operating observability tools (Prometheus, Grafana, Loki, Promtail, and OpenTelemetry) within the Inferr Kubernetes cluster.

---

## 🏗️ Observability Stack Architecture

```
                               ┌───────────────────┐
                               │  Grafana (UI)     │
                               │  Port: 3000       │
                               └─────────┬─────────┘
                                         │
                    ┌────────────────────┴────────────────────┐
                    ▼                                         ▼
         ┌─────────────────────┐                   ┌─────────────────────┐
         │ Prometheus          │                   │ Grafana Loki        │
         │ (Metrics Engine)    │                   │ (Log Aggregator)    │
         └──────────▲──────────┘                   └──────────▲──────────┘
                    │                                         │
         ┌──────────┴──────────┐                   ┌──────────┴──────────┐
         │ Inferr API Pods     │                   │ Promtail DaemonSet  │
         │ (OpenTelemetry /    │                   │ (Node Log Scraper)  │
         │  /metrics Endpoint) │                   └─────────────────────┘
         └─────────────────────┘
```

---

## 🚀 1. Deploying Monitoring Stack

Deploy the namespace, Prometheus, and Grafana:

```bash
kubectl apply -f kubernetes/monitoring/prometheus-grafana.yaml
```

Deploy Loki and Promtail log collector daemonset:

```bash
kubectl apply -f kubernetes/monitoring/loki-promtail.yaml
```

Verify all pods are running in the `monitoring` namespace:

```bash
kubectl get pods -n monitoring
```

---

## 📊 2. Accessing Grafana Dashboards

Port-forward the Grafana service to local machine:

```bash
kubectl port-forward svc/grafana-service 3000:3000 -n monitoring
```

Open browser at `http://localhost:3000`:
- **Default Username:** `admin`
- **Default Password:** `admin`

---

## 🔍 3. Data Source Configuration

### Prometheus Metrics Data Source
1. Navigate to **Configuration > Data Sources > Add Data Source**.
2. Select **Prometheus**.
3. Set URL to `http://prometheus-service.monitoring.svc.cluster.local:9090`.
4. Click **Save & Test**.

### Loki Logs Data Source
1. Navigate to **Configuration > Data Sources > Add Data Source**.
2. Select **Loki**.
3. Set URL to `http://loki-service.monitoring.svc.cluster.local:3100`.
4. Click **Save & Test**.

---

## 📈 4. Core Metrics Tracked

| Metric | Target / Description |
|---|---|
| `http_requests_total` | Total HTTP requests handled by API pods |
| `http_request_duration_seconds` | Latency distribution (p50, p95, p99) |
| `process_cpu_seconds_total` | CPU utilization per pod replica |
| `process_resident_memory_bytes` | Node.js Heap & Resident Memory |
| `pg_pool_active_connections` | Drizzle / Postgres pool active connections |
