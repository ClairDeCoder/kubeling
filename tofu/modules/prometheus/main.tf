resource "helm_release" "prometheus" {
  name             = "prometheus"
  repository       = "https://prometheus-community.github.io/helm-charts"
  chart            = "prometheus"
  namespace        = "monitoring"
  create_namespace = true
  version          = "27.5.1"

  values = [yamlencode({
    alertmanager              = { enabled = false }
    prometheus-pushgateway    = { enabled = false }
    kube-state-metrics        = { enabled = false }
    prometheus-node-exporter  = { enabled = false }

    server = {
      persistentVolume = { enabled = false }

      remoteWrite = [{
        url = var.grafana_remote_write_url
        basic_auth = {
          username      = var.grafana_username
          password_file = "/etc/secrets/grafana-remote-write/password"
        }
      }]

      extraVolumes = [{
        name   = "grafana-remote-write"
        secret = { secretName = "grafana-remote-write" }
      }]

      extraVolumeMounts = [{
        name      = "grafana-remote-write"
        mountPath = "/etc/secrets/grafana-remote-write"
        readOnly  = true
      }]
    }

    extraScrapeConfigs = yamlencode([{
      job_name       = "kubeling-spawner"
      metrics_path   = "/metrics"
      static_configs = [{ targets = ["kubeling-spawner.default.svc.cluster.local:80"] }]
    }])
  })]
}
