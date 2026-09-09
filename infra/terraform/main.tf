terraform {
  required_version = ">= 1.6.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Hunch: local state is fine until Ops picks a bucket. Do not commit tfstate.
  # backend "gcs" {
  #   bucket = "github-bounties-tfstate"
  #   prefix = "staging"
  # }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {
  project_id = var.project_id
}

check "locked_project_number" {
  assert {
    condition     = data.google_project.this.number == var.project_number
    error_message = "Expected project number ${var.project_number} for ${var.project_id}."
  }
}

locals {
  labels = {
    product = "github-bounties"
    env     = "staging"
  }

  apis = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
    "vpcaccess.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "serviceusage.googleapis.com",
    "sts.googleapis.com",
  ]

  # Ticket list + ADR 0001 CDP names. Empty placeholders — no versions.
  secret_ids = [
    "DATABASE_URL",
    "GITHUB_APP_PRIVATE_KEY",
    "GITHUB_WEBHOOK_SECRET",
    "CDP_API_KEY_ID",
    "CDP_API_KEY_SECRET",
    "CDP_WALLET_SECRET",
    "CDP_PROJECT_ID",
    "CDP_CLIENT_API_KEY",
    "CDP_WEBHOOK_SECRET",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
  ]
}

resource "google_project_service" "apis" {
  for_each           = toset(local.apis)
  project            = var.project_id
  service            = each.key
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = var.ar_repo
  description   = "GitHub Bounties container images (staging)"
  format        = "DOCKER"
  labels        = local.labels
  depends_on    = [google_project_service.apis]
}

resource "google_secret_manager_secret" "placeholders" {
  for_each  = toset(local.secret_ids)
  secret_id = each.key
  labels    = local.labels
  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_service_account" "runtime" {
  account_id   = "github-bounties-runtime"
  display_name = "GitHub Bounties runtime (Cloud Run)"
}

resource "google_service_account" "build" {
  account_id   = "github-bounties-build"
  display_name = "GitHub Bounties Cloud Build"
}

resource "google_service_account" "ci" {
  account_id   = "github-bounties-ci"
  display_name = "GitHub Bounties CI (WIF — no user keys)"
}

resource "google_project_iam_member" "runtime_secrets" {
  project = var.project_id
  role    = "roles/secretmanager.secretAccessor"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "runtime_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_project_iam_member" "build_ar" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${google_service_account.build.email}"
}

resource "google_service_account_iam_member" "build_uses_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.build.email}"
}

resource "google_project_iam_member" "ci_ar" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

resource "google_project_iam_member" "ci_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

resource "google_project_iam_member" "ci_build" {
  project = var.project_id
  role    = "roles/cloudbuild.builds.editor"
  member  = "serviceAccount:${google_service_account.ci.email}"
}

resource "google_service_account_iam_member" "ci_uses_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.ci.email}"
}

# Staging Cloud SQL. Off by default so terraform apply can succeed before billing/VPC.
# Set create_sql = true in terraform.tfvars after billing is attached.
# Human lock: LB_MVP1_Billing_account. gcloud billing id: 011B0B-3BA3C5-CCE451.
resource "google_sql_database_instance" "staging" {
  count            = var.create_sql ? 1 : 0
  name             = var.sql_instance
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.sql_tier
    availability_type = "ZONAL"
    disk_size         = 10
    disk_type         = "PD_SSD"
    edition           = "ENTERPRISE"

    backup_configuration {
      enabled    = true
      start_time = "09:00"
    }

    ip_configuration {
      ipv4_enabled    = var.sql_private_ip ? false : true
      private_network = var.sql_private_ip ? var.vpc_self_link : null
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    user_labels = local.labels
  }

  deletion_protection = true
  depends_on          = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  count    = var.create_sql ? 1 : 0
  name     = "github_bounties"
  instance = google_sql_database_instance.staging[0].name
}
