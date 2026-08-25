#!/usr/bin/env bash
#
# grant-adx-access.sh
# ---------------------------------------------------------------------------
# Grants the FinOps Dashboard Managed Identity the ADX "Database Viewer" role
# on one or more Kusto databases (FinOps Hub uses two: Hub and Ingestion).
#
# This is the manual post-deployment step described in:
#   docs/operations/security.md  (Step 2)
#   docs/guides/hands-on.md  (Grant Database Viewer Access)
#
# The ARM/Bicep template injects ADX_CLUSTER_URI + the Managed Identity, but it
# does NOT grant RBAC on the (external) ADX cluster. Run this after the deploy
# so that isMockMode() resolves to false and the dashboard serves real data.
#
# Requirements:
#   - Azure CLI logged in (az login) with Kusto cluster "Contributor" on the
#     target cluster (needed to create principal assignments).
#   - The dashboard deployment must expose the "managedIdentityPrincipalId"
#     output (it does, see infra/bicep/finops-dashboard/main.bicep).
#
# Usage:
#   ./grant-adx-access.sh \
#     --resource-group        rg-finops-dashboard \
#     --cluster-name          mykustocluster \
#     --cluster-resource-group rg-adx \
#     [--deployment-name       main] \
#     [--databases            "Hub Ingestion"] \
#     [--principal-id          <objectId>]   # skip deployment lookup
#
# All flags can also be supplied as environment variables (UPPER_SNAKE_CASE),
# e.g. CLUSTER_NAME=mykustocluster.
# ---------------------------------------------------------------------------

set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
RESOURCE_GROUP="${RESOURCE_GROUP:-}"
DEPLOYMENT_NAME="${DEPLOYMENT_NAME:-main}"
CLUSTER_NAME="${CLUSTER_NAME:-}"
CLUSTER_RESOURCE_GROUP="${CLUSTER_RESOURCE_GROUP:-}"
DATABASES="${DATABASES:-Hub Ingestion}"
PRINCIPAL_ID="${PRINCIPAL_ID:-}"

# ── Parse arguments ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --resource-group)         RESOURCE_GROUP="$2"; shift 2 ;;
    --deployment-name)        DEPLOYMENT_NAME="$2"; shift 2 ;;
    --cluster-name)           CLUSTER_NAME="$2"; shift 2 ;;
    --cluster-resource-group) CLUSTER_RESOURCE_GROUP="$2"; shift 2 ;;
    --databases)              DATABASES="$2"; shift 2 ;;
    --principal-id)           PRINCIPAL_ID="$2"; shift 2 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Run with --help for usage." >&2
      exit 1 ;;
  esac
done

# ── Validate ────────────────────────────────────────────────────────────────
fail() { echo "ERROR: $1" >&2; exit 1; }

command -v az >/dev/null 2>&1 || fail "Azure CLI (az) not found in PATH."
[[ -n "$CLUSTER_NAME" ]]            || fail "--cluster-name is required."
[[ -n "$CLUSTER_RESOURCE_GROUP" ]] || fail "--cluster-resource-group is required."

# ── Resolve the Managed Identity principal id ───────────────────────────────
if [[ -z "$PRINCIPAL_ID" ]]; then
  [[ -n "$RESOURCE_GROUP" ]] || fail "--resource-group is required to look up the Managed Identity (or pass --principal-id)."
  echo "→ Reading managedIdentityPrincipalId from deployment '$DEPLOYMENT_NAME' in '$RESOURCE_GROUP'..."
  PRINCIPAL_ID="$(az deployment group show \
    -g "$RESOURCE_GROUP" -n "$DEPLOYMENT_NAME" \
    --query "properties.outputs.managedIdentityPrincipalId.value" -o tsv)"
  [[ -n "$PRINCIPAL_ID" ]] || fail "Could not read managedIdentityPrincipalId output from deployment '$DEPLOYMENT_NAME'."
fi

echo "→ Managed Identity principal id: $PRINCIPAL_ID"
echo "→ Cluster: $CLUSTER_NAME (rg: $CLUSTER_RESOURCE_GROUP)"
echo "→ Databases: $DATABASES"
echo

# ── Grant Viewer on each database ───────────────────────────────────────────
for DB in $DATABASES; do
  ASSIGNMENT_NAME="finops-dashboard-viewer-$(echo "$DB" | tr '[:upper:]' '[:lower:]')"
  echo "→ Granting Database Viewer on '$DB' (assignment: $ASSIGNMENT_NAME)..."
  az kusto database-principal-assignment create \
    --cluster-name "$CLUSTER_NAME" \
    --database-name "$DB" \
    --resource-group "$CLUSTER_RESOURCE_GROUP" \
    --principal-assignment-name "$ASSIGNMENT_NAME" \
    --principal-id "$PRINCIPAL_ID" \
    --principal-type App \
    --role Viewer \
    --output none
  echo "  ✓ Done."
done

echo
echo "→ Verifying assignments..."
for DB in $DATABASES; do
  echo "  Database: $DB"
  az kusto database-principal-assignment list \
    --cluster-name "$CLUSTER_NAME" \
    --database-name "$DB" \
    --resource-group "$CLUSTER_RESOURCE_GROUP" \
    --query "[?principalId=='$PRINCIPAL_ID'].{principal:principalId, role:role, type:principalType}" \
    -o table
done

echo
echo "All done. The Managed Identity now has Database Viewer on: $DATABASES"
echo "If the dashboard still shows mock/empty data, confirm analyticsBackend=ADX"
echo "and that ADX_CLUSTER_URI / ADX_DATABASE are set on the Container App."
