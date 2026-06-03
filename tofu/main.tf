provider "aws" {
  region = var.aws_region
}

provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

provider "helm" {
  kubernetes = {
    host                   = module.eks.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks.cluster_ca_certificate)
    exec = {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
    }
  }
}

module "prometheus" {
  source                   = "./modules/prometheus"
  grafana_remote_write_url = "https://prometheus-prod-66-prod-us-east-3.grafana.net/api/prom/push"
  grafana_username         = "3278700"

  depends_on = [module.eks, module.kubernetes]
}

module "vpc" {
  source       = "./modules/vpc"
  aws_region   = var.aws_region
  cluster_name = var.cluster_name
  app_name     = var.app_name
}

module "ecr" {
  source   = "./modules/ecr"
  app_name = var.app_name
}

module "eks" {
  source             = "./modules/eks"
  cluster_name       = var.cluster_name
  aws_region         = var.aws_region
  vpc_id             = module.vpc.vpc_id
  private_subnet_ids = module.vpc.private_subnet_ids
  app_name           = var.app_name
}

module "dynamodb" {
  source   = "./modules/dynamodb"
  app_name = var.app_name
}

module "iam" {
  source            = "./modules/iam"
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.oidc_provider_url
  table_arn         = module.dynamodb.table_arn
  cluster_name      = var.cluster_name
  app_name          = var.app_name
}

module "alb" {
  source            = "./modules/alb"
  cluster_name      = var.cluster_name
  vpc_id            = module.vpc.vpc_id
  oidc_provider_arn = module.eks.oidc_provider_arn
  oidc_provider_url = module.eks.oidc_provider_url
  domain            = var.domain
  app_name          = var.app_name
  aws_region        = var.aws_region
}

module "kubernetes" {
  source                 = "./modules/kubernetes"
  cluster_name           = var.cluster_name
  cluster_endpoint       = module.eks.cluster_endpoint
  cluster_ca_certificate = module.eks.cluster_ca_certificate
  ecr_repository_url     = module.ecr.repository_url
  image_tag              = var.image_tag
  irsa_role_arn          = module.iam.irsa_role_arn
  acm_certificate_arn    = module.alb.acm_certificate_arn
  waf_acl_arn            = module.alb.waf_acl_arn
  app_name               = var.app_name
  domain                 = var.domain
  dynamodb_table_name    = module.dynamodb.table_name
  aws_region             = var.aws_region
}

module "route53" {
  source       = "./modules/route53"
  domain       = var.domain
  alb_dns_name = module.kubernetes.alb_dns_name
}