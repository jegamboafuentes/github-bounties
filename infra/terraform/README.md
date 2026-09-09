# Terraform sketch for GitHub Bounties staging

Mirrors [`../gcloud`](../gcloud). Prefer the gcloud scripts if you do not already run Terraform for this org.

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
# terraform apply   # needs ADC + billing
```

`create_sql` defaults to **false**. Cloud Run hello is **not** a Terraform resource — use `cloudbuild.yaml` or `../gcloud/deploy-hello.sh` so we never invent a `*.run.app` URL in state.

Do not commit `terraform.tfvars` or `*.tfstate`.
