#!/usr/bin/env bash
# Pull the container images used by CODE_RUNNER=docker. Run once on each API host.
set -euo pipefail
IMAGES=(node:24-alpine python:3.12-alpine gcc:14 eclipse-temurin:21-jdk-alpine golang:1.23-alpine rust:1-alpine)
for img in "${IMAGES[@]}"; do
  echo ">> pulling $img"
  docker pull "$img"
done
echo "done"
