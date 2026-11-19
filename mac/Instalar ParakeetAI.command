#!/bin/bash
# Instalador de ParakeetAI para macOS (Apple Silicon e Intel).
# Construye la app en este Mac, la firma localmente y la copia a ~/Applications.
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"

echo "== ParakeetAI · instalador para Mac =="

# 1) Requisitos de sistema: macOS 14.2+ para captar el audio del sistema.
OSV="$(sw_vers -productVersion)"
echo "macOS $OSV"
MAJOR="${OSV%%.*}"; REST="${OSV#*.}"; MINOR="${REST%%.*}"
if [ "$MAJOR" -lt 14 ] || { [ "$MAJOR" -eq 14 ] && [ "${MINOR:-0}" -lt 2 ]; }; then
  echo "AVISO: macOS $OSV es anterior a 14.2. El micrófono funcionará, pero el audio del sistema (entrevistador) NO."
fi

# 2) Node.js: usa el del sistema si es >= 22.12; si no, descarga uno portátil aquí (sin admin).
NODE_VER="24.14.0"
ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] || ARCH="x64"
need_node=1
if command -v node >/dev/null 2>&1; then
  node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' && need_node=0
fi
if [ $need_node -eq 1 ]; then
  if [ ! -x "$DIR/.node/bin/node" ]; then
    echo "Descargando Node.js $NODE_VER ($ARCH) desde nodejs.org…"
    mkdir -p "$DIR/.node"
    curl -fL "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-darwin-$ARCH.tar.gz" \
      | tar -xz -C "$DIR/.node" --strip-components 1
  fi
  export PATH="$DIR/.node/bin:$PATH"
fi
echo "Node $(node -v)"

# 3) Dependencias (Electron ~100 MB) y build.
echo "Instalando dependencias (puede tardar unos minutos)…"
npm install --no-audit --no-fund
echo "Construyendo ParakeetAI.app…"
APP_SRC="$(node build.js | tail -n 1)/ParakeetAI.app"
[ -f "$APP_SRC/Contents/Resources/app/.env" ] || { echo "ERROR: falta .env dentro de la app"; exit 1; }

# 4) Firma ad-hoc (obligatoria en Apple Silicon tras modificar Info.plist).
codesign --force --deep --sign - "$APP_SRC"

# 5) Copiar a ~/Applications y abrir.
mkdir -p "$HOME/Applications"
rm -rf "$HOME/Applications/ParakeetAI.app"
cp -R "$APP_SRC" "$HOME/Applications/"
echo ""
echo "Listo: ParakeetAI instalado en ~/Applications (Aplicaciones de tu usuario)."
echo "Al usar el botón del entrevistador, macOS pedirá permisos: acéptalos y reabre la app."
open "$HOME/Applications/ParakeetAI.app"
