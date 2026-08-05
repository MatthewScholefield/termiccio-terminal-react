#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p src/generated
protoc \
  --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es \
  --es_out=src/generated \
  --es_opt=target=ts \
  -I ../termiccio-terminal/proto \
  ../termiccio-terminal/proto/terminal.proto
