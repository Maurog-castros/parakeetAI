# parakeet-mvp

MVP de asistente de entrevista en tiempo real (overlay). Código propio, inspirado en el género.

**Flujo:** audio de sistema (loopback de Electron) → chunks WAV 16k → STT en `ia.iamiko.cl` → `chat/completions` → sugerencia en overlay.

## Características
- Overlay frameless, always-on-top y transparente. Oculto de capturas por defecto; puede hacerse visible al compartir desde **Configuración**.
- Captura de **audio de sistema** (lo que dice el entrevistador) vía loopback — sin código nativo.
- STT + LLM vía gateway OpenAI-compatible `https://ia.iamiko.cl/v1`.
- `Ctrl+Shift+Space`: mostrar/ocultar. Botón click-through para dejar pasar el ratón.
- Práctica con entrevistador IA: 2–10 preguntas habladas, respuestas por micrófono y evaluación final.
- **Modo reunión** (selector 💼/👥 en la barra): para cualquier conversación — reuniones de trabajo, llamadas o charlas entre amigos. Notas en vivo, resumen y memoria de pendientes entre conversaciones.

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
| `DEEPGRAM_API_KEY` | voz del entrevistador (TTS) en modo práctica y STT del entrevistador en modo chino |
| `DEEPGRAM_TTS_MODEL` | voz del entrevistador (def. `aura-2-olivia-es`) |

## Entrevista Teams / Meet
- No requiere integración: el overlay capta el **audio de sistema** (lo que suena por los altavoces), así que oye al entrevistador en Teams/Meet/Zoom igual. Ten la llamada con audio por altavoces (no modo exclusivo).
- Pulsa **⚙ Configuración** y pega la **descripción del cargo** y tu **CV** (o cárgalo .txt/.md/.pdf). Ahí también defines el máximo de caracteres (120–1500), el formato de respuesta (bullets o texto continuo) e instrucciones personales para el LLM. Se guarda en disco (`userData/parakeet-context.json`) y persiste entre sesiones.
- La puerta de voz (`STT_URL`) transcribe y, al terminar cada frase del entrevistador, genera la sugerencia por la misma conexión con tus reglas, CV y cargo (mensaje `Configure`). Detecta preguntas y propone una respuesta oral, natural y profesional en 1ª persona, alineada a las funciones del cargo y respaldada por el CV. Si no es pregunta, no responde.

## Modo reunión
- Elige **👥 Reunión** en el selector de la barra. 🖥 escucha a los demás (Teams/Meet/Zoom); 🎙 tu voz o una conversación en persona.
- **Notas en vivo**: tras cada frase, la puerta de voz anota solo lo relevante — 💡 idea, ✅ pendiente, 📌 decisión, 🔁 retoma de un pendiente anterior, ❓ pregunta abierta. La charla trivial se ignora.
- **📝 Resumir**: genera título, resumen, ideas, decisiones, pendientes nuevos (con responsable), pendientes anteriores que se dieron por cerrados, próximos pasos e iniciativas. Se agrega al log (`transcripciones/`) y se guarda en la memoria. Resumir de nuevo la misma sesión reemplaza el resumen anterior.
- **🧠 Memoria** (`userData/parakeet-memory.json`): pendientes abiertos (marcar hecho / eliminar), completados y conversaciones anteriores. Los pendientes abiertos y los últimos resúmenes se envían como contexto a las notas en vivo y al resumen siguiente. **💡 Proponer próximos pasos** sugiere prioridades, acciones e iniciativas solo a partir de la memoria.
- En ⚙ Configuración, *Contexto de las conversaciones* (opcional) describe quién participa y de qué se trata.

## Idiomas del entrevistador
- Selector en el panel de transcripción. **Auto**: la puerta de voz (modelo parakeet-tdt-0.6b-v3) detecta sola español, inglés y otros idiomas europeos, también mezclados frase a frase. **No reconoce chino.**
- **中文 Chino → Español**: el audio del entrevistador va directo a Deepgram (`nova-2`, `zh-CN`; usa `DEEPGRAM_API_KEY` y consume su saldo). Cada frase se traduce al español con el LLM de chat y aparece en una segunda columna; las respuestas sugeridas se generan a partir de la traducción. Tu micrófono sigue por la puerta de voz. El log guarda original y traducción.

## Límites del MVP
- Solo audio de sistema (no micro). STT por chunks de 5 s (latencia ~5–7 s).
- Si el gateway no expone `/audio/transcriptions`, STT falla → ver "Siguientes pasos".
- Click-through: al activarlo, el ratón pasa a través; usa el atajo para ocultar.

## Siguientes pasos
- STT en streaming (menor latencia).
- Mezclar micro + sistema con etiquetas de hablante.
- Fallback STT local (whisper.cpp) si el gateway no transcribe.
