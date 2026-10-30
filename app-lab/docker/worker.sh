#!/bin/sh
set -eu
mkdir -p "$HOME/.cache"
cp -R /opt/opencode-cache/. "$HOME/.cache/"
exec opencode run --auto --format json "$1"
