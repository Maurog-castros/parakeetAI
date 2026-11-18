# ParakeetAI — hallazgos de binarios (máquina local)

Install: `C:\Users\Mauro-local\AppData\Local\Programs\parakeetai-desktop`
Datos: `%APPDATA%\parakeetai-desktop` · Updater: `%LOCALAPPDATA%\parakeetai-desktop-updater`

## Tipo
App **Electron**. Main exe = 249 MB (`⠀.exe`, nombre = char invisible braille U+2800, truco anti-detección en lista de ventanas/procesos).
Update vía GitHub: `parakeetai/parakeetai-desktop-releases`.
Firmado por **PARAKEETAI d.o.o.** (Croacia).

## Binarios
| Archivo | Tamaño | Qué es |
|---|---|---|
| `⠀.exe` | 249 MB | Electron main (Chromium+Node) |
| `resources\app.asar` | 372 MB | **todo el JS/TS de la app** (sin extraer aún) |
| `app.asar.unpacked\dist\main\parakeetai-native.win32-x64-msvc.node` | 1.38 MB | **addon nativo propio** |
| DLLs Electron (ffmpeg, dxcompiler, vulkan, swiftshader...) | — | runtime estándar, no tocar |

Nativo multiplataforma incluido: darwin-arm64/x64, win32-arm64/x64.

## Addon nativo (único binario propio a analizar)
Lenguaje: **Rust** (napi-rs 3.10.5 + tokio). rustc `58cf8f9c...`. PDB: `parakeetai_native.pdb`.
Módulos fuente Rust vistos en strings:
- `src\audio_processor\api.rs`
- `src\output_loopback\api.rs` + `convert.rs`
- `src\platform\windows\ffi.rs`

Funciones napi exportadas a JS:
- `processMicAudio`, `pushSystemAudio`, `flushMic`
- `getActiveAudioInputProcesses` (enumera qué apps graban → detecta Zoom/Teams/Meet)
- `listOutputDevices`, `requestSystemAudioAccess`, `read_privacy_access`
- Clases: `AudioProcessor`, `OutputLoopbackCapture`; config `sampleRate`

API Windows usada: WASAPI / MMDeviceEnumerator (captura loopback de audio de sistema + micro).

## Conclusión
Rol del nativo = **motor de audio** (captura micro + loopback de sistema, enumeración de procesos de audio). NO hay red, LLM, ni cifrado aquí.
Transcripción, prompts a LLM (OpenAI/Anthropic/Google), overlay y lógica → **viven en el JS dentro de `app.asar`**.
Anti-detección = no captura de pantalla (por diseño) + ventana con título invisible, a nivel Electron, no en el nativo.

## Siguientes pasos
1. `npx asar extract app.asar out\` → leer JS: endpoints, auth, flujo LLM. (mayor valor)
2. Ghidra/GhidraMCP sobre `parakeetai-native.win32-x64-msvc.node` → detalle del motor de audio (tiene PDB → símbolos).
3. mitmproxy sobre la app → protocolo de red real.
