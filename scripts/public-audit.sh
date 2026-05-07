#!/usr/bin/env bash
set -euo pipefail

forbidden_files='(^|/)(\.env($|\.)|.*\.(pem|key|p12|mobileprovision)$)'

if git ls-files | grep -E "$forbidden_files" >/tmp/testgen-forbidden-files.txt; then
  echo "Forbidden public-repo files found:"
  cat /tmp/testgen-forbidden-files.txt
  exit 1
fi

if git grep -n -I -E '(/Users/|pkuilove|sshpass|117\.50\.|BEGIN (RSA|OPENSSH|PRIVATE)|PRIVATE KEY|api[_-]?key|access[_-]?key|secret|token|passwd|password)' -- \
  ':(exclude)pnpm-lock.yaml' \
  ':(exclude)package-lock.json' \
  ':(exclude)scripts/public-audit.sh'; then
  echo "Potential sensitive content found. Review matches before publishing."
  exit 1
fi

echo "public audit ok"
