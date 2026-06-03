data "aws_route53_zone" "main" {
  name = "brandonsweat.net"
}

data "aws_elb_hosted_zone_id" "main" {}

resource "aws_route53_record" "kubeling" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = var.domain
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = data.aws_elb_hosted_zone_id.main.id
    evaluate_target_health = true
  }
}