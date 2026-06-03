variable "grafana_remote_write_url" {
  type        = string
  description = "Grafana Cloud Prometheus remote_write endpoint"
}

variable "grafana_username" {
  type        = string
  description = "Grafana Cloud stack ID (username for remote_write basic auth)"
}