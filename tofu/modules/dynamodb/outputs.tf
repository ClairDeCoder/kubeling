output "table_name" {
  value = aws_dynamodb_table.kubelings.name
}

output "table_arn" {
  value = aws_dynamodb_table.kubelings.arn
}