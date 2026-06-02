output "acm_certificate_arn" {
  value = aws_acm_certificate_validation.main.certificate_arn
}

output "waf_acl_arn" {
  value = aws_wafv2_web_acl.main.arn
}