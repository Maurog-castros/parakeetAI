#!/bin/bash
# Instalador de ParakeetAI para macOS (Apple Silicon e Intel).
# Primera vez: construye la app en este Mac (Electron ~100 MB), la firma
# localmente y la copia a ~/Applications. Actualizaciones: si la app instalada
# usa la misma versión de Electron, solo reemplaza el código (segundos).
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"
DEST="$HOME/Applications/ParakeetAI.app"
RES="Contents/Resources/app"

echo "== ParakeetAI · instalador para Mac =="

# 1) Requisitos de sistema: macOS 14.2+ para captar el audio del sistema.
OSV="$(sw_vers -productVersion)"
echo "macOS $OSV"
MAJOR="${OSV%%.*}"; REST="${OSV#*.}"; MINOR="${REST%%.*}"
if [ "$MAJOR" -lt 14 ] || { [ "$MAJOR" -eq 14 ] && [ "${MINOR:-0}" -lt 2 ]; }; then
  echo "AVISO: macOS $OSV es anterior a 14.2. El micrófono funcionará, pero el audio del sistema (entrevistador) NO."
fi

# Huella de la "base" de la app (versión de Electron y opciones del build).
# Si no cambia, basta con copiar el código nuevo.
STAMP="$(cat package.json build.js | shasum -a 256 | cut -d' ' -f1)"

quit_app() {
  if pgrep -x ParakeetAI >/dev/null 2>&1; then
    echo "Cerrando ParakeetAI…"
    osascript -e 'quit app "ParakeetAI"' >/dev/null 2>&1 || true
    sleep 2
    pkill -x ParakeetAI >/dev/null 2>&1 || true
  fi
}

finish() {
  # Configuración inicial: un asistente.conf junto a este instalador se copia a
  # ~/Documents/ParakeetAI solo si el usuario aún no tiene uno.
  CONF_DIR="$HOME/Documents/ParakeetAI"
  if [ -f "$DIR/asistente.conf" ] && [ ! -f "$CONF_DIR/asistente.conf" ]; then
    mkdir -p "$CONF_DIR"
    cp "$DIR/asistente.conf" "$CONF_DIR/asistente.conf"
    echo "Configuración inicial copiada a $CONF_DIR/asistente.conf"
  fi
  echo ""
  echo "Listo: $1"
  echo "Si el botón 🖥 o 📸 da error de permiso: Ajustes del Sistema > Privacidad y seguridad >"
  echo "Grabación de pantalla y audio del sistema > activa ParakeetAI, y reabre la app."
  open "$DEST"
}

# 2) Actualización rápida: misma base -> reemplazar src/ y .env, volver a firmar.
if [ -f "$DEST/$RES/.build-stamp" ] && [ "$(cat "$DEST/$RES/.build-stamp")" = "$STAMP" ]; then
  echo "ParakeetAI ya está instalado: actualizando solo el código…"
  quit_app
  rm -rf "$DEST/$RES/src"
  cp -R src "$DEST/$RES/src"
  cp .env "$DEST/$RES/.env"
  # Firma solo el paquete exterior (Electron no cambió y ya está firmado).
  codesign --force --sign - "$DEST"
  finish "ParakeetAI actualizado."
  exit 0
fi

# 3) Instalación completa.
# Node.js: usa el del sistema si es >= 22.12; si no, descarga uno portátil aquí (sin admin).
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

echo "Instalando dependencias (la primera vez tarda unos minutos)…"
npm install --no-audit --no-fund
echo "Construyendo ParakeetAI.app…"
APP_SRC="$(node build.js | tail -n 1)/ParakeetAI.app"
[ -f "$APP_SRC/$RES/.env" ] || { echo "ERROR: falta .env dentro de la app"; exit 1; }
echo "$STAMP" > "$APP_SRC/$RES/.build-stamp"

# Firma ad-hoc completa (obligatoria en Apple Silicon tras modificar Info.plist).
echo "Firmando la app (1-2 minutos)…"
codesign --force --deep --sign - "$APP_SRC"

quit_app
mkdir -p "$HOME/Applications"
rm -rf "$DEST"
cp -R "$APP_SRC" "$HOME/Applications/"
finish "ParakeetAI instalado en ~/Applications (Aplicaciones de tu usuario)."
