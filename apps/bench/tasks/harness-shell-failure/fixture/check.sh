#!/bin/sh
# Fails until flag.txt exists with content "ready"
if [ -f flag.txt ] && [ "$(cat flag.txt)" = "ready" ]; then
  exit 0
fi
echo "missing flag" >&2
exit 1
