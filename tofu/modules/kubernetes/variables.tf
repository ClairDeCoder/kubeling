variable "cluster_name" {
  type = string
}

variable "cluster_endpoint" {
  type = string
}

variable "cluster_ca_certificate" {
  type = string
}

variable "ecr_repository_url" {
  type = string
}

variable "image_tag" {
  type = string
}

variable "irsa_role_arn" {
  type = string
}

variable "acm_certificate_arn" {
  type = string
}

variable "waf_acl_arn" {
  type = string
}

variable "app_name" {
  type = string
}

variable "domain" {
  type = string
}

variable "dynamodb_table_name" {
  type = string
}

variable "aws_region" {
  type = string
}