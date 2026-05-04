#!/usr/bin/env bash
#
# Deploy dossier_ui to Google Cloud Run as `ruflo-dossier-fns`.
# Mirrors v3/goal_ui/scripts/gcp-deploy-cloudrun.sh — same project,
# same region, same secret stack, separate service.
#
# Run from v3/dossier_ui/. Idempotent.
#
# Env vars (sane defaults; override as needed):
#   PROJECT_ID                  gcloud config default
#   REGION                      us-central1
#   RUFLO_FUNCTIONS_TOKEN       openssl rand -hex 32 (auto-generated)
#   RUFLO_ALLOWED_ORIGINS       https://dossier.ruv.io,https://goal.ruv.io
#   RUFLO_RATE_LIMIT_PER_MIN    60
#   RUFLO_ANTHROPIC_SECRET_NAME ANTHROPIC_API_KEY
#   RUFLO_TOKEN_SECRET_NAME     RUFLO_FUNCTIONS_TOKEN
#   SERVICE_NAME                ruflo-dossier-fns
#   MIN_INSTANCES               1   (no cold start on public domain)

set -euo pipefail

cd "$(dirname "$0")/.." # → v3/dossier_ui/

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || echo '')}"
REGION="${REGION:-us-central1}"
SECRET_NAME="${RUFLO_ANTHROPIC_SECRET_NAME:-ANTHROPIC_API_KEY}"
TOKEN_SECRET_NAME="${RUFLO_TOKEN_SECRET_NAME:-RUFLO_FUNCTIONS_TOKEN}"
SERVICE_NAME="${SERVICE_NAME:-ruflo-dossier-fns}"
RUFLO_TOKEN="${RUFLO_FUNCTIONS_TOKEN:-}"
ALLOWED_ORIGINS="${RUFLO_ALLOWED_ORIGINS:-https://dossier.ruv.io,https://goal.ruv.io}"
RATE_LIMIT="${RUFLO_RATE_LIMIT_PER_MIN:-60}"
MIN_INSTANCES="${MIN_INSTANCES:-1}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID not set" >&2
  echo "Run: gcloud config set project <PROJECT_ID>" >&2
  exit 2
fi

echo "==> Building SPA (Vite)"
npm run build

if [[ -z "$RUFLO_TOKEN" ]]; then
  echo "==> Reading RUFLO_FUNCTIONS_TOKEN from Secret Manager ($TOKEN_SECRET_NAME)"
  if ! RUFLO_TOKEN="$(gcloud secrets versions access latest --secret="$TOKEN_SECRET_NAME" --project="$PROJECT_ID" 2>/dev/null)"; then
    echo "==> Secret not found. Generating a new token and creating it."
    RUFLO_TOKEN="$(openssl rand -hex 32)"
    printf '%s' "$RUFLO_TOKEN" | gcloud secrets create "$TOKEN_SECRET_NAME" --data-file=- --project="$PROJECT_ID"
  fi
fi

echo "==> Deploying $SERVICE_NAME to Cloud Run ($REGION, project=$PROJECT_ID)"
gcloud run deploy "$SERVICE_NAME" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --allow-unauthenticated \
  --min-instances "$MIN_INSTANCES" \
  --port 8787 \
  --set-env-vars "RUFLO_ALLOWED_ORIGINS=$ALLOWED_ORIGINS,RUFLO_RATE_LIMIT_PER_MIN=$RATE_LIMIT" \
  --set-secrets "RUFLO_FUNCTIONS_TOKEN=$TOKEN_SECRET_NAME:latest,ANTHROPIC_API_KEY=$SECRET_NAME:latest" \
  --quiet

URL="$(gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT_ID" --format='value(status.url)')"
echo ""
echo "✅ Deployed: $URL"
echo ""
echo "Next steps:"
echo "  1. Map domain: gcloud beta run domain-mappings create --service=$SERVICE_NAME --domain=dossier.ruv.io --region=$REGION"
echo "  2. Add the dossier origin to goal_ui's RUFLO_ALLOWED_ORIGINS if cross-origin calls are needed:"
echo "     gcloud run services update ruflo-research-fns --region=$REGION --update-env-vars RUFLO_ALLOWED_ORIGINS=...,https://dossier.ruv.io"
echo "  3. Health check: curl $URL/healthz"
