#!/bin/sh
# Stands in for a project's lint/typecheck: fails until the agent adds fixed.txt.
if [ ! -f fixed.txt ]; then
  echo "verify-check.sh(1,1): error TS0001: fixed.txt is missing." >&2
  exit 1
fi
echo "ok"
