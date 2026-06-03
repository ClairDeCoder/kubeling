# Kubeling

Kubeling is a browser-based virtual pet platform built on EKS, provisioned with OpenTofu.

Each visitor can launch a dedicated Kubeling instance running inside a real Kubernetes pod. The Kubeling remains alive until it dies in-game or the browser disconnects. When either event occurs, the pod is terminated and the Kubeling's final stats are written to DynamoDB.

The project was built to explore dynamic pod creation, infrastructure automation, and operating a complete application stack on AWS.

**Live Demo:** https://kubeling.brandonsweat.net

**Demo Video:** [![Watch the video]](https://youtu.be/q7t0ZjuPHHA)

---

## Overview

A user can launch a Kubeling directly from the application interface.

1. User launches a Kubeling.
2. The spawner service creates a dedicated pod through the Kubernetes API.
3. The Kubeling becomes active and begins tracking its stats.
4. The user keeps the Kubeling alive through interaction.
5. When the Kubeling dies or the browser disconnects, its final state is persisted in Dynamo and the pod is removed.

The gameplay mechanics allude to Kubernetes concepts:

| Application Concept | Kubernetes Equivalent |
| ------------------- | --------------------- |
| Launch Kubeling     | Pod creation          |
| Active Kubeling     | Running pod           |
| Kubeling death      | Pod termination       |
| Browser disconnect  | Pod termination       |
| Historical records  | Persistent state      |

---

## Why?

Kubernetes usually runs silently behind the scenes, I wanted to exemplify the nature of K8s and present it in an easily digestible concept.

Every Kubeling is a real pod, and its lifecycle directly reflects the lifecycle of a Kubernetes workload. Creating, running, and terminating workloads becomes visible through gameplay rather than dashboards and command-line tools.

The goal was to build and operate a complete platform that exercises infrastructure provisioning, workload orchestration, observability, deployment automation, and AWS service integration in a single project.

---

## Technology Stack

***Application***
 - Python
 - FastAPI
 - WebSockets
 - HTML/CSS/JavaScript

***Platform***
 - Kubernetes (EKS)
 - OpenTofu
 - AWS ALB Controller
 - DynamoDB
 - ECR
 - Route53
 - IAM / IRSA
 - WAF with geo-restriction: whitelist [US, CA]

***Observability***
 - Prometheus
 - Grafana Cloud

***Delivery***
 - GitHub Actions
 - Docker

---

## Architecture

***Diagram Incoming***

```
Browser
  -> Route53 (kubeling.brandonsweat.net)
  -> ALB (HTTPS, WAF geo-restricted: US + CA)
  -> Spawner Pod (always-on Deployment)
      -> K8s API: create Kubeling Pod
      -> WS proxy: browser ↔ spawner ↔ kubeling pod
  -> Kubeling Pod (per-user, on-demand)
      -> DynamoDB write on death (via IRSA)
```

Two services share one Docker image. The spawner runs by default:
`CMD ["uvicorn", "backend.spawner.main:app", "--host", "0.0.0.0", "--port", "3000"]`
Kubeling pods override the entrypoint to:
`CMD ["uvicorn", "backend.pod.main:app", "--host", "0.0.0.0", "--port", "3001"]`

---

## Local Dev

```powershell
# Install dependencies
pip install -r requirements.txt

# Run in local mode (no K8s, kubeling runs in-process)
$env:LOCAL_DEV="true"; python -m backend.spawner.main
```

---

## Engineering Challenges

### 1. Deprecated kubernetes provider resource types

**Error:**
```
Warning: Deprecated Resource: use kubernetes_service_account_v1
```

**Cause:** The kubernetes provider version requires `_v1` suffixes on unversioned resource types.

**Fix:** Renamed all affected resources in `tofu/modules/kubernetes/main.tf`:
- E.G. `kubernetes_service_account` -> `kubernetes_service_account_v1`

---

### 2. EKS cluster data sources read at plan time

**Error:**
```
Error: reading EKS Cluster (kubeling-cluster): couldn't find resource
  with data.aws_eks_cluster.main
```

**Cause:** `data "aws_eks_cluster"` and `data "aws_eks_cluster_auth"` are evaluated at plan time. On first run the cluster doesn't exist yet, so the plan fails.

**Fix:** Removed both data sources. Updated the `kubernetes` and `helm` providers to reference `module.eks` outputs directly and use `exec` (`aws eks get-token`) for auth instead of a static token.

---

### 3. IAM permissions: 403 AccessDenied

**Error:**
```
Error: creating IAM Role: AccessDenied not authorized to perform iam:CreateRole
```

**Cause:** The `kubeling_user` IAM identity running OpenTofu didn't have IAM permissions.

**Fix:** Attached `AdministratorAccess` to `kubeling_user` in the AWS console.

---

### 4. Spawner Deployment rollout failure: no image in ECR

**Error:**
```
Error: Waiting for rollout to finish: 1 replicas wanted; 0 replicas Ready
```

**Cause:** The Deployment referenced the ECR image before anything had been pushed to ECR.

**Fix:** Built and pushed the Docker image to ECR before re-running `tofu apply`.

---

### 5. kubernetes_deployment_v1 identity change error

**Error:**
```
Error: Unexpected Identity Change during read operation
Current Identity: api_version: null
New Identity: api_version: apps/v1
```

**Cause:** OpenTofu 1.12 introduced resource identities. The first failed apply left a null identity in state; the subsequent apply found a real one and refused to proceed.

**Fix:**
```powershell
tofu state rm module.kubernetes.kubernetes_deployment_v1.spawner
kubectl delete deployment kubeling-spawner -n default
tofu apply
```

---

### 6. Route53 alias record: wrong zone ID

**Error:**
```
Error: InvalidChangeBatch alias target does not lie within the target zone
```

**Cause:** The `alias` block in `tofu/modules/route53/main.tf` used the Route53 hosted zone ID for both fields. The ALB alias target requires the ALB's own hosted zone ID, not the domain's.

**Fix:** Added `data "aws_elb_hosted_zone_id" "main" {}` and used `data.aws_elb_hosted_zone_id.main.id` in the alias block.

---

### 7. WebSocket blocked: mixed content on HTTPS

**Error (browser console):**
```
Uncaught DOMException: The operation is insecure.
  connectWebSocket app.js:181
```

**Cause:** `app.js` hardcoded `ws://` for the WebSocket URL. Browsers block `ws://` connections from pages served over `https://`.

**Fix:** Derived the protocol from `window.location.protocol`:
```js
const WS_URL = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
```

---

### 8. Pod creation forbidden: wrong ServiceAccount name

**Error:**
```
pods "kubeling-xxx" is forbidden: error looking up service account default/kubeling-pod-sa: serviceaccount "kubeling-pod-sa" not found
```

**Cause:** The spawner code referenced `kubeling-pod-sa` but the ServiceAccount deployed by OpenTofu is named `kubeling-pod`.

**Diagnose:**
```
kubectl get serviceaccounts -n default
```

**Fix:** Updated `service_account_name` in `backend/spawner/main.py` to `kubeling-pod`.

---

### 9. Kubeling pods pulling wrong image

**Error:**
```
Failed to pull image "kubeling:local": pull access denied
```

**Cause:** `backend/config.py` defaults `POD_IMAGE` to `kubeling:local`. The `POD_IMAGE` environment variable was never added to the spawner Deployment, so it used the local fallback in production.

**Diagnose:**
```
kubectl describe pod <kubeling-pod-name> -n default
```

**Fix:** Added `POD_IMAGE = "${var.ecr_repository_url}:${var.image_tag}"` to the spawner Deployment env vars in `tofu/modules/kubernetes/main.tf`.

---

### 10. DynamoDB write failing: type mismatch on GSI key

**Error (pod logs):**
```
WARNING: DynamoDB write failed: ValidationException when calling PutItem:
Type mismatch for Index Key alive Expected: S Actual: BOOL
IndexName: alive-born_at-index
```

**Cause:** `db.py` wrote `"alive": False` (Python bool). The GSI partition key `alive` is typed as String (`S`) in DynamoDB. Type mismatches on index keys cause the entire write to be rejected.

**Diagnose:**
```
kubectl logs -l app=kubeling-pod -n default
```

**Fix:** Changed to `"alive": "false"` (string) in `backend/db.py` to match the GSI schema.

---

### 11. DynamoDB write race condition: pod deleted before write completes

**Cause:** When a session ends, the spawner closes the pod's WebSocket then immediately calls `_delete_pod_sync`. The pod's `finally` block calls `save_death` on disconnect, but the pod receives SIGTERM from the delete before the DynamoDB write can complete.

**Fix:** The pod's `on_death` callback now calls `save_death` before closing its WebSocket. The spawner detects the closed WebSocket via asyncio.wait, sends the termination receipt, then deletes the pod. For disconnects, the spawner waits 1 second after the browser drops before deleting, giving the pod's finally block time to finish.

---

### 12. Node full: kubeling pods stuck in Pending

**Error:**
```
0/1 nodes are available: 1 Too many pods.
preemption: 0/1 nodes are available: 1 No preemption victims found for incoming pod.
```

**Cause:** `t3.small` instances are capped at 11 pods by the VPC CNI (based on ENI count). System pods (kube-proxy, aws-node, coredns, ALB controller) consume 5–6 slots, leaving only ~5 slots for app pods. Kubeling pods that failed to clean up after stat deaths accumulated on the node until it was full.

**Diagnose:**
```
kubectl describe node
```

**Fix:** Deleted stuck pods manually with `kubectl delete pods -l app=kubeling-pod -n default`. Root cause fixed separately; pods now close their own WebSocket on death so the spawner's cleanup path always runs.

---

### 13. Prometheus metrics registration crash: spawner CrashLoopBackOff after adding prometheus_client

**Error (pod logs):**
```
ValueError: Duplicated timeseries in CollectorRegistry: {'kubelings_alive'}
```

**Cause:** `prometheus_client` registers metrics in a global `CollectorRegistry` at module import time. Uvicorn's `reload=True` mode imports the prom module twice, once in the reloader watcher process and once in the worker. This causes the `Gauge` definitions to attempt double-registration and crash.

**Diagnose:**
```
kubectl logs -n default deployment/kubeling-spawner
```

**Diagnosis:** The annotation change from `tofu apply` triggered a rolling update of the spawner Deployment. The new pod started with the current image (which already had `prometheus_client` installed from the updated `requirements.txt`) and immediately entered `CrashLoopBackOff`. The old pod stayed alive because Kubernetes won't terminate the old replica until the new one is healthy, blocking the rollout indefinitely.

**Fix:** Changed `reload=True` to `reload=LOCAL_DEV` in the `__main__` block of `backend/spawner/main.py`. The reloader is only active in local dev; in production `LOCAL_DEV=false` so uvicorn runs without reload and the module is imported exactly once.

---

### 14. Prometheus pod stuck Pending: unbound PersistentVolumeClaim

**Error (kubectl describe pod):**
```
Warning  FailedScheduling  0/1 nodes are available: pod has unbound immediate PersistentVolumeClaims.
```

**Cause:** The `prometheus-community/prometheus` Helm chart wants a PersistentVolumeClaim by default, but EKS has no default StorageClass out of the box; you'd need to install the EBS CSI driver first. Without it, the claim never gets bound and the pod just sits there unscheduled

**Why local persistence isn't needed here:** Prometheus is configured to remote_write all metrics to Grafana Cloud. Local TSDB storage is only used for buffering and local querying. Neither is needed when the data store is Grafana Cloud.

**Fix:** Set `server.persistentVolume.enabled = false` in the Helm values inside `tofu/modules/prometheus/main.tf`. Prometheus runs with in-memory storage only and remote_writes everything upstream.

**Cleanup before re-applying:** The failed Helm release must be uninstalled first.

```powershell
helm uninstall prometheus -n monitoring
```
Then `tofu apply`.

---

### 15. Prometheus CrashLoopBackOff: `basicAuth` not valid in prometheus.yml / Kubernetes secret refs not supported

**Error (pod logs):**
```
Error loading config (--config.file=/etc/config/prometheus.yml): yaml: unmarshal errors:
  line 6: field basicAuth not found in type config.plain
```

**Cause:** Two mistakes in the original Helm values:

1. **Wrong key name**: Prometheus config uses `basic_auth`. The Helm values used `basicAuth`, which `yamlencode` passed through as-is. Prometheus rejected the field.

2. **Wrong credential approach**: The Kubernetes secret reference syntax (`{ name: "secret-name", key: "key" }`) is a feature of the **Prometheus Operator** CRDs (`RemoteWrite` custom resource). The `prometheus-community/prometheus` chart is **vanilla Prometheus** and it writes values directly into `prometheus.yml` as plain config. Vanilla Prometheus has no mechanism to look up Kubernetes secrets at runtime; it only reads files and environment variables.

**Diagnose:**
```
kubectl logs -n monitoring deploy/prometheus-server -c prometheus-server
```

**Fix:** Switched to `password_file`, vanilla Prometheus supports reading the password from a file path. The K8s secret is mounted as a volume into the Prometheus pod, which makes each secret key available as a file. The config references the file path instead of the secret directly:

```yaml
basic_auth:
  username: "3278700"
  password_file: /etc/secrets/grafana-remote-write/password
```

The Helm values mount the secret:
```yaml
server:
  extraVolumes:
    - name: grafana-remote-write
      secret:
        secretName: grafana-remote-write
  extraVolumeMounts:
    - name: grafana-remote-write
      mountPath: /etc/secrets/grafana-remote-write
      readOnly: true
```

Kubernetes writes each key in the secret as a file at the mount path, so `/etc/secrets/grafana-remote-write/password` contains the token at runtime. Never in config, never in tofu state, never in git!

---

### 16. Prometheus metrics gauges stuck at 0: spawner has no DynamoDB credentials

**Symptom:** `/metrics` endpoint returns all Kubeling gauges at `0.0` despite records existing in DynamoDB. Spawner logs show:
```
WARNING:backend.spawner.main:Metrics refresh failed: Unable to locate credentials
```

**Cause:** The `get_stats()` background task added to the spawner calls DynamoDB to populate death-related gauges. The spawner's Kubernetes ServiceAccount (`kubeling-spawner`) had no IRSA annotation, only `kubeling-pod` had one. Without IRSA, the spawner pod has no AWS credentials and boto3 fails every scan.

**Fix:** Two changes in OpenTofu:

1. `tofu/modules/iam/main.tf`: expanded the IRSA role's trust policy to allow both `kubeling-pod` and `kubeling-spawner` to assume it:
```json
"sub": [
  "system:serviceaccount:default:kubeling-pod",
  "system:serviceaccount:default:kubeling-spawner"
]
```

2. `tofu/modules/kubernetes/main.tf`: added the IRSA role ARN annotation to the spawner ServiceAccount:
```yaml
eks.amazonaws.com/role-arn: <irsa_role_arn>
```

After `tofu apply`, restart the spawner so it picks up the new annotation:
```powershell
kubectl rollout restart deployment/kubeling-spawner -n default
```
