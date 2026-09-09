output "project_id" {
  value = var.project_id
}

output "project_number" {
  value = data.google_project.this.number
}

output "region" {
  value = var.region
}

output "artifact_registry" {
  value = google_artifact_registry_repository.images.id
}

output "runtime_sa" {
  value = google_service_account.runtime.email
}

output "build_sa" {
  value = google_service_account.build.email
}

output "ci_sa" {
  value = google_service_account.ci.email
}

output "secret_ids" {
  value = sort([for s in google_secret_manager_secret.placeholders : s.secret_id])
}

output "sql_connection_name" {
  value       = try(google_sql_database_instance.staging[0].connection_name, null)
  description = "PROJECT:REGION:INSTANCE for Cloud Run --set-cloudsql-instances. Null until create_sql=true."
}

output "cloud_run_hello_url" {
  value       = null
  description = "Not managed here. Deploy via cloudbuild.yaml / infra/gcloud/deploy-hello.sh. Do not invent a URL."
}
