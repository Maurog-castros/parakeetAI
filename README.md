# parakeet-mvp

MVP de asistente de entrevista en tiempo real (overlay). Código propio, inspirado en el género.

**Flujo:** audio de sistema (loopback de Electron) → chunks WAV 16k → STT en `ia.iamiko.cl` → `chat/completions` → sugerencia en overlay.

## Características
- Overlay frameless, always-on-top y transparente. Oculto de capturas por defecto; puede hacerse visible al compartir desde **Configuración**.
- Captura de **audio de sistema** (lo que dice el entrevistador) vía loopback — sin código nativo.
- STT + LLM vía gateway OpenAI-compatible `https://ia.iamiko.cl/v1`.
- `Ctrl+Shift+Space`: mostrar/ocultar. Botón click-through para dejar pasar el ratón.
- Práctica con entrevistador IA: 2–10 preguntas habladas, respuestas por micrófono y evaluación final.

## Requisitos
- Windows (loopback de audio). Node 18+.

## Setup
```bash
npm install
copy .env.example .env   # y rellenar IAMIKO_TOKEN y STT_TOKEN
npm start
```
Al arrancar, la consola imprime los modelos disponibles del gateway (`[iamiko] models: ...`). Usa esos nombres en `.env`.

## Config (.env)
| var | qué |
|---|---|
| `IAMIKO_BASE_URL` | gateway de chat (def. `https://ia.iamiko.cl/vscode/v1`) |
| `IAMIKO_TOKEN` | clave del gateway de chat (obligatorio) |
| `CHAT_MODEL` | modelo de chat (p.ej. el que liste /models) |
| `STT_URL` | STT en vivo, WebSocket compatible Deepgram (def. `wss://stt.iamiko.cl/v1/listen`) |
| `STT_TOKEN` | clave de la puerta de voz (obligatorio) |
| `STT_LANG` | idioma (def. es) |
| `DEEPGRAM_API_KEY` | solo para la voz del entrevistador (TTS) en modo práctica |
| `DEEPGRAM_TTS_MODEL` | voz del entrevistador (def. `aura-2-olivia-es`) |

## Entrevista Teams / Meet
- No requiere integración: el overlay capta el **audio de sistema** (lo que suena por los altavoces), así que oye al entrevistador en Teams/Meet/Zoom igual. Ten la llamada con audio por altavoces (no modo exclusivo).
- Pulsa **⚙ Configuración** y pega la **descripción del cargo** y tu **CV** (o cárgalo .txt/.md/.pdf). Ahí también defines el máximo de caracteres (120–1500), el formato de respuesta (bullets o texto continuo) e instrucciones personales para el LLM. Se guarda en disco (`userData/parakeet-context.json`) y persiste entre sesiones.
- La puerta de voz (`STT_URL`) transcribe y, al terminar cada frase del entrevistador, genera la sugerencia por la misma conexión con tus reglas, CV y cargo (mensaje `Configure`). Detecta preguntas y propone una respuesta oral, natural y profesional en 1ª persona, alineada a las funciones del cargo y respaldada por el CV. Si no es pregunta, no responde.

## Límites del MVP
- Solo audio de sistema (no micro). STT por chunks de 5 s (latencia ~5–7 s).
- Si el gateway no expone `/audio/transcriptions`, STT falla → ver "Siguientes pasos".
- Click-through: al activarlo, el ratón pasa a través; usa el atajo para ocultar.

## Siguientes pasos
- STT en streaming (menor latencia).
- Mezclar micro + sistema con etiquetas de hablante.
- Fallback STT local (whisper.cpp) si el gateway no transcribe.
