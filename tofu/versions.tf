terraform {
    backend "s3" {
        bucket         = "kubeling-tofu-state"
        key            = "kubeling/terraform.tfstate"
        region         = "us-east-1"
        dynamodb_table = "kubeling-tofu-locks"
        encrypt        = true
    }

    required_version = ">= 1.12"

    required_providers {
        aws = {
            source  = "hashicorp/aws"
            version = "~> 6.47.0"
        }
        kubernetes = {
            source  = "hashicorp/kubernetes"
            version = "~> 3.1.0"
        }
        helm = {
            source  = "hashicorp/helm"
            version = "~> 3.1.2"
        }
    }
}
