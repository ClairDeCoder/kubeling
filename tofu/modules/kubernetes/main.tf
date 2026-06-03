resource "kubernetes_service_account_v1" "kubeling_pod" {
  metadata {
    name      = "kubeling-pod"
    namespace = "default"
    annotations = {
      "eks.amazonaws.com/role-arn" = var.irsa_role_arn
    }
  }
}

resource "kubernetes_service_account_v1" "spawner" {
  metadata {
    name      = "kubeling-spawner"
    namespace = "default"
  }
}

resource "kubernetes_cluster_role_v1" "spawner" {
  metadata {
    name = "kubeling-spawner"
  }

  rule {
    api_groups = [""]
    resources  = ["pods"]
    verbs      = ["get", "list", "watch", "create", "delete"]
  }
}

resource "kubernetes_cluster_role_binding_v1" "spawner" {
  metadata {
    name = "kubeling-spawner"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role_v1.spawner.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account_v1.spawner.metadata[0].name
    namespace = "default"
  }
}

resource "kubernetes_deployment_v1" "spawner" {
  metadata {
    name      = "kubeling-spawner"
    namespace = "default"
  }

  spec {
    replicas = 1

    selector {
      match_labels = {
        app = "kubeling-spawner"
      }
    }

    template {
      metadata {
        labels = {
          app = "kubeling-spawner"
        }
      }

      spec {
        service_account_name = kubernetes_service_account_v1.spawner.metadata[0].name

        container {
          name  = "spawner"
          image = "${var.ecr_repository_url}:${var.image_tag}"

          port {
            container_port = 3000
          }

          env {
            name  = "DYNAMODB_TABLE_NAME"
            value = var.dynamodb_table_name
          }

          env {
            name  = "AWS_REGION"
            value = var.aws_region
          }

          env {
            name  = "APP_PORT"
            value = "3000"
          }

          env {
            name  = "LOCAL_DEV"
            value = "false"
          }

          env {
            name  = "POD_IMAGE"
            value = "${var.ecr_repository_url}:${var.image_tag}"
          }

          resources {
            requests = {
              cpu    = "100m"
              memory = "128Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "512Mi"
            }
          }

          liveness_probe {
            http_get {
              path = "/stats"
              port = 3000
            }
            initial_delay_seconds = 10
            period_seconds        = 15
          }

          readiness_probe {
            http_get {
              path = "/stats"
              port = 3000
            }
            initial_delay_seconds = 5
            period_seconds        = 10
          }
        }
      }
    }
  }
}

resource "kubernetes_service_v1" "spawner" {
  metadata {
    name      = "kubeling-spawner"
    namespace = "default"
  }

  spec {
    selector = {
      app = "kubeling-spawner"
    }

    port {
      port        = 80
      target_port = 3000
    }

    type = "ClusterIP"
  }
}

resource "kubernetes_horizontal_pod_autoscaler_v2" "spawner" {
  metadata {
    name      = "kubeling-spawner"
    namespace = "default"
  }

  spec {
    scale_target_ref {
      api_version = "apps/v1"
      kind        = "Deployment"
      name        = kubernetes_deployment_v1.spawner.metadata[0].name
    }

    min_replicas = 1
    max_replicas = 3

    metric {
      type = "Resource"
      resource {
        name = "cpu"
        target {
          type                = "Utilization"
          average_utilization = 70
        }
      }
    }
  }
}

resource "kubernetes_ingress_v1" "spawner" {
  metadata {
    name      = "kubeling-spawner"
    namespace = "default"

    annotations = {
      "kubernetes.io/ingress.class"                  = "alb"
      "alb.ingress.kubernetes.io/scheme"             = "internet-facing"
      "alb.ingress.kubernetes.io/target-type"        = "ip"
      "alb.ingress.kubernetes.io/certificate-arn"    = var.acm_certificate_arn
      "alb.ingress.kubernetes.io/listen-ports"       = "[{\"HTTPS\":443}]"
      "alb.ingress.kubernetes.io/ssl-redirect"       = "443"
      "alb.ingress.kubernetes.io/wafv2-acl-arn"      = var.waf_acl_arn
    }
  }

  spec {
    rule {
      host = var.domain

      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service_v1.spawner.metadata[0].name
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }
}
