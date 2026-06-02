variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "cluster_name" {
  type    = string
  default = "kubeling-cluster"
}

variable "app_name" {
  type    = string
  default = "kubeling"
}

variable "domain" {
  type    = string
  default = "kubeling.brandonsweat.net"
}

variable "image_tag" {
  type        = string
  description = "ECR image tag"
  default     = "latest"
}