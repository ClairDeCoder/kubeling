resource "aws_iam_policy" "kubeling_pod_dynamodb" {
  name = "${var.app_name}-pod-dynamodb"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:PutItem",
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:Scan"
      ]
      Resource = [
        var.table_arn,
        "${var.table_arn}/index/*"
      ]
    }]
  })
}

resource "aws_iam_role" "kubeling_pod" {
  name = "${var.app_name}-pod-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = var.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${var.oidc_provider_url}:sub" = "system:serviceaccount:default:kubeling-pod"
          "${var.oidc_provider_url}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "kubeling_pod_dynamodb" {
  role       = aws_iam_role.kubeling_pod.name
  policy_arn = aws_iam_policy.kubeling_pod_dynamodb.arn
}