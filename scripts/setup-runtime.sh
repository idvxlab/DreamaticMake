#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

python_bin="${MAKE_ENGINE_PYTHON:-python3}"
if [ ! -x ".runtime/python/bin/python" ]; then
  "$python_bin" -m venv .runtime/python
fi

.runtime/python/bin/python -m pip install -r requirements.txt
npm ci

echo "DreamaticMaker runtime is ready."
