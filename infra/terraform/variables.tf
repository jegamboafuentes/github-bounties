variable "project_id" {
  type        = string
  description = "Locked GCP project id."
  default     = "github-bounties"
}

variable "project_number" {
  type        = string
  description = "Locked GCP project number (asserted via a terraform check)."
  default     = "133702056111"
}

variable "region" {
  type        = string
  description = "Hunch: us-central1 until Ops picks a region."
  default     = "us-central1"
}

variable "ar_repo" {
  type    = string
  default = "github-bounties"
}

variable "create_sql" {
  type        = bool
  description = "Create staging Cloud SQL. Leave false until billing is attached."
  default     = false
}

variable "sql_instance" {
  type    = string
  default = "github-bounties-staging"
}

variable "sql_tier" {
  type        = string
  description = "Staging shared-core. If the API rejects db-f1-micro, try db-g1-small."
  default     = "db-f1-micro"
}

variable "sql_private_ip" {
  type        = bool
  description = "Preferred once VPC + PSA peering exist. False = public IP + ENCRYPTED_ONLY (interim)."
  default     = false
}

variable "vpc_self_link" {
  type        = string
  description = "Required when sql_private_ip is true."
  default     = null
}
