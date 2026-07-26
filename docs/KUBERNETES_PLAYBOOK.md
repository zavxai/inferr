# Kubernetes Playbook & Developer Guide

A practical guide and reference playbook for mastering Kubernetes concepts, deployment workflows, and cluster troubleshooting for the Inferr project.

---

## 🧭 Core Concepts & Architecture Overview

```
                                  ┌────────────────────────┐
                                  │      Ingress (L7)      │
                                  └───────────┬────────────┘
                                              │
                                  ┌───────────▼────────────┐
                                  │      Service (L4)      │
                                  └───────────┬────────────┘
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
                    ▼                                                   ▼
      ┌───────────────────────────┐                       ┌───────────────────────────┐
      │   Deployment (API Pods)   │                       │   StatefulSet (Postgres)  │
      ├───────────────────────────┤                       ├───────────────────────────┤
      │  Pod 1  │  Pod 2  │  ...  │                       │  Postgres Pod + PVC       │
      └───────────────────────────┘                       └───────────────────────────┘
```

| Component | Role in Inferr |
|---|---|
| **Deployment** | Manages stateless NestJS API and worker pod replicas (`api-deployment.yaml`). |
| **StatefulSet** | Manages stateful database instances requiring persistent storage (`postgres-statefulset.yaml`). |
| **Service** | Internal load balancer providing stable IP/DNS endpoints for pods (`api-service.yaml`). |
| **Ingress** | Exposes HTTP routes externally to cluster traffic (`ingress.yaml`). |
| **ConfigMap & Secret** | Manages non-sensitive configuration and sensitive credentials (`configmap.yaml`, `secrets.yaml`). |
| **PersistentVolumeClaim (PVC)** | Requests storage capacity from host/cloud providers (`postgres-pvc.yaml`). |

---

## ⚡ Essential `kubectl` Command Cheatsheet

### Cluster Info & Context
```bash
kubectl cluster-info                     # View cluster master endpoint
kubectl get nodes -o wide                # List cluster nodes & IP addresses
kubectl config get-contexts              # View configured cluster contexts
kubectl config set-context --current --namespace=default  # Switch default namespace
```

### Resource Inspection
```bash
kubectl get pods                         # List pods in default namespace
kubectl get all -n monitoring            # List all resources in monitoring namespace
kubectl describe pod <pod-name>          # Detailed pod status, events, and failure reasons
kubectl get deployment api-deployment -o yaml  # View live deployment YAML config
```

### Debugging & Troubleshooting
```bash
# View pod logs (real-time stream)
kubectl logs -f <pod-name>

# View logs from a specific container inside multi-container pod
kubectl logs -f <pod-name> -c api-container

# Execute interactive shell inside running pod
kubectl exec -it <pod-name> -- /bin/sh

# Forward pod or service port to localhost
kubectl port-forward svc/api-service 3001:3001
```

### Rollouts & Deployment Management
```bash
# Update deployment image
kubectl set image deployment/api-deployment api=ghcr.io/zavxai/inferr/api:latest

# Check rollout progress
kubectl rollout status deployment/api-deployment

# Undo last deployment (rollback)
kubectl rollout undo deployment/api-deployment

# Scale deployment replicas manually
kubectl scale deployment/api-deployment --replicas=3
```

---

## 🚨 Common Kubernetes Pod Failure Modes & Solutions

### 1. `CrashLoopBackOff`
- **Cause:** Application crashes inside container on startup (missing environment variable, uncaught exception, or failed DB connection).
- **Diagnosis:** Run `kubectl logs <pod-name> --previous` to see why the previous container crashed.

### 2. `ImagePullBackOff` / `ErrImagePull`
- **Cause:** Kubernetes cannot download container image (incorrect image tag, invalid registry secret, or network timeout).
- **Diagnosis:** Run `kubectl describe pod <pod-name>` and inspect the **Events** section at the bottom.

### 3. `OOMKilled` (Out of Memory)
- **Cause:** Pod memory consumption exceeded container `limits.memory`.
- **Diagnosis:** Increase `resources.limits.memory` in deployment manifest (`api-deployment.yaml`).

### 4. `Pending` PVC State
- **Cause:** Storage class or volume cannot be provisioned.
- **Diagnosis:** Verify local dynamic provisioner or hostPath directory permissions.
