#!/usr/bin/env bash
# Rupture du contrat d'API (ADR-004 §7) : compare openapi.yaml à celui de la
# branche de base avec oasdiff et échoue sur tout changement incompatible
# (champ de réponse retiré, statut changé, entrée devenue obligatoire…).
# Lancé par la CI sur chaque PR (job `check`) ; en local : `make api-breaking`.
#
# Ajouter un code d'erreur à une énumération n'est qu'un avertissement : les
# codes de problème sont faits pour grossir (ADR-004 §3), le front garde un
# message par défaut. Une rupture voulue passe par une ADR acceptée et le
# label `rupture-contrat` sur la PR (voir docs/api/README.md).
set -euo pipefail

BASE_REF="${1:-origin/main}"
VERSION="1.34.1"
SHA256="75775f65b0adebd26a8e013af51a799342dfdc6262d89efa9e3b7bdf89657d90"
CACHE="node_modules/.cache/oasdiff-${VERSION}"
BIN="${CACHE}/oasdiff"

if [ ! -x "$BIN" ]; then
  mkdir -p "$CACHE"
  archive="${CACHE}/oasdiff.tar.gz"
  curl -fsSL -o "$archive" \
    "https://github.com/oasdiff/oasdiff/releases/download/v${VERSION}/oasdiff_${VERSION}_linux_amd64.tar.gz"
  echo "${SHA256}  ${archive}" | sha256sum -c --quiet -
  tar -xzf "$archive" -C "$CACHE" oasdiff
fi

base="$(mktemp)"
trap 'rm -f "$base"' EXIT
if ! git show "${BASE_REF}:openapi.yaml" > "$base" 2>/dev/null; then
  echo "openapi.yaml absent de ${BASE_REF} : rien à comparer."
  exit 0
fi

"$BIN" breaking "$base" openapi.yaml \
  --severity-levels scripts/oasdiff-levels.txt \
  --fail-on ERR \
  --format "${OASDIFF_FORMAT:-text}"
echo "Aucune rupture du contrat d'API par rapport à ${BASE_REF}."
