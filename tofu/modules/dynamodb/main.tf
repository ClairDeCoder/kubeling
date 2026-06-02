resource "aws_dynamodb_table" "kubelings" {
  name         = "kubelings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "kubeling_name"

  attribute {
    name = "kubeling_name"
    type = "S"
  }

  attribute {
    name = "alive"
    type = "S"
  }

  attribute {
    name = "born_at"
    type = "S"
  }

  global_secondary_index {
    name            = "alive-born_at-index"

    key_schema {
      attribute_name = "alive"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "born_at"
      key_type       = "RANGE"
    }    
  
    projection_type = "ALL"
  }

  tags = {
    Name = "${var.app_name}-kubelings"
  }
}