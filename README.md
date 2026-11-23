# ParakeetAI

Asistente de conversaciones en tiempo real (overlay de escritorio, Electron). Código propio, inspirado en el género.

Tiene dos modos:

- **💼 Entrevista**: copiloto de entrevistas laborales. Escucha al entrevistador y sugiere respuestas alineadas a tu CV y al cargo. Incluye una práctica con entrevistador IA.
- **👥 Reunión**: para cualquier conversación (reuniones de trabajo, llamadas, charlas entre amigos). Toma notas en vivo, resume, detecta ideas y pendientes, recuerda lo pendiente de conversaciones anteriores y propone próximos pasos e iniciativas.

**Flujo:** audio del sistema (loopback) y/o micrófono → STT en streaming por WebSocket (puerta de voz `stt.iamiko.cl`) → sugerencias o notas generadas por la misma conexión → overlay. Los resúmenes, traducciones y la práctica usan el gateway de chat (`ia.iamiko.cl`, compatible con OpenAI).

## Características
- Overlay sin marco, siempre visible y transparente. Barra compacta que se expande a transcripción + panel de respuestas o notas.
- **Oculto en capturas y al compartir pantalla** por defecto (botón 📷 o ⚙ Configuración para hacerlo visible).
- Dos fuentes: 🖥 **audio del sistema** (lo que suena por los altavoces: Teams, Meet, Zoom…) y 🎙 **micrófono**, cada una con su propia conexión de STT.
- Sin integración con la app de videollamada: basta con que el audio salga por los altavoces o auriculares del sistema.
- Ícono en la bandeja (gris = en pausa, verde = escuchando) con menú para mostrar, activar el paso del ratón o salir.
- Cada sesión se guarda en **su propia carpeta** (transcripción + resumen, pendientes, ideas y próximos pasos) y se puede revisar desde **📚 Historial**.
- Windows y macOS 14.2+.

## Requisitos
- Node 18+ (para desarrollo).
- Windows 10/11, o macOS 14.2 (Sonoma) o más nuevo para capturar el audio del sistema.
- Tokens del gateway de chat (`IAMIKO_TOKEN`) y de la puerta de voz (`STT_TOKEN`).

## Setup
```bash
npm install
copy .env.example .env   # rellenar IAMIKO_TOKEN y STT_TOKEN (macOS: cp)
npm start
```
Al arrancar, la consola imprime los modelos disponibles del gateway (`[iamiko] models: ...`). Usa esos nombres en `CHAT_MODEL`.

Tests: `npm test` (node:test, sin dependencias extra).

## Config (.env)
| var | qué |
|---|---|
| `IAMIKO_BASE_URL` | gateway de chat (def. `https://ia.iamiko.cl/vscode/v1`) |
| `IAMIKO_TOKEN` | clave del gateway de chat (**obligatorio**) |
| `CHAT_MODEL` | modelo de chat (def. `auto-vscode`; usa uno de los que lista `/models`) |
| `VISION_MODEL` | opcional: modelo con visión para 📸 Captura (def. `CHAT_MODEL`) |
| `STT_URL` | STT en vivo, WebSocket compatible con Deepgram (def. `wss://stt.iamiko.cl/v1/listen`) |
| `STT_TOKEN` | clave de la puerta de voz (**obligatorio**) |
| `STT_LANG` | idioma del STT (def. `es`) |
| `STT_MODEL` | modelo de STT (def. `nova-2`) |
| `DEEPGRAM_API_KEY` | opcional: voz del entrevistador (TTS) en la práctica y STT en modo chino |
| `DEEPGRAM_TTS_MODEL` | voz del entrevistador en la práctica (def. `aura-2-olivia-es`) |

## Atajos
| atajo | acción |
|---|---|
| `Ctrl+Shift+Space` | mostrar / ocultar el asistente |
| `Ctrl+Shift+M` | paso del ratón (los clics atraviesan la ventana) |
| `Ctrl+Shift+Q` | salir |
| `Ctrl+Shift+X` | capturar la pantalla y adjuntarla a la conversación |
| `Ctrl+Shift+Enter` | pedir respuesta ahora (solo mientras se escucha el audio del sistema) |
| `Ctrl+Shift+Backspace` | limpiar y empezar una sesión nueva (ídem) |
| `Ctrl+←` / `Ctrl+→` | respuesta o nota anterior / siguiente |

En macOS se usa `Cmd` en lugar de `Ctrl` (salvo `Ctrl+←/→`).

## 📸 Captura de pantalla
- **📸 Captura** (o `Ctrl+Shift+X`, en cualquier momento) toma un pantallazo de la pantalla donde está el asistente y lo adjunta a la conversación. El overlay no sale en la imagen.
- En la captura adjunta, escribe opcionalmente qué necesitas (p. ej. *resuelve el ejercicio*) y pulsa **💡 Sugerir**: el asistente responde en base a la imagen, la conversación reciente y tu contexto (CV/cargo o contexto de la reunión). Los ejercicios de código vienen con la solución en un bloque.
- La imagen se guarda como `captura_HH-MM-SS.jpg` en la carpeta de la sesión y queda enlazada en `transcripcion.md`.
- Requiere un modelo con visión en el gateway (`VISION_MODEL`). En macOS pide el permiso de *Grabación de pantalla*.

## 💼 Modo entrevista
- Pulsa **⚙ Configuración** y pega la **descripción del cargo** y tu **CV** (o cárgalo desde .txt, .md o .pdf). Ahí también defines el largo máximo de la respuesta (120–1500 caracteres), el formato (lista de puntos o texto continuo) e instrucciones personales. Se guarda en `userData/parakeet-context.json`.
- 🖥 escucha al entrevistador. Al terminar cada frase, la puerta de voz detecta si es una pregunta y propone una respuesta oral, natural y en primera persona, alineada al cargo y respaldada por el CV, sin inventar experiencia. Si no es pregunta, no responde.
- **Auto respuesta** responde cada pregunta sola; si la desactivas, pide la respuesta con **Responder** (`Ctrl+Shift+Enter`).
- **Mis preguntas**: si 🎙 está activo, también explica brevemente lo que preguntas tú.
- Historial de respuestas navegable (`Ctrl+←/→`) y botón para copiar.

### 🎤 Práctica de entrevista
Simulación de 2 a 10 preguntas generadas según tu CV y el cargo. Para cada pregunta: voz del entrevistador opcional (🔊, requiere `DEEPGRAM_API_KEY`), una respuesta óptima de referencia y tu respuesta por micrófono. Al final (o antes, con *Terminar y evaluar*) entrega puntaje, fortalezas, aspectos a mejorar, una respuesta rehecha y un plan de práctica.

### Idiomas del entrevistador
- Selector en el panel de transcripción. **Auto**: la puerta de voz (parakeet-tdt-0.6b-v3) detecta español, inglés y otros idiomas europeos, también mezclados. **No reconoce chino.**
- **中文 Chino → Español**: el audio del sistema va directo a Deepgram (`nova-2`, `zh-CN`; usa `DEEPGRAM_API_KEY` y consume su saldo). Cada frase se traduce al español en una segunda columna y las sugerencias se generan a partir de la traducción. El micrófono sigue por la puerta de voz. El log guarda original y traducción.

## 👥 Modo reunión
Elige **👥 Reunión** en el selector de la barra (queda guardado). 🖥 escucha a los demás en la videollamada; 🎙 capta tu voz o una conversación en persona.

- **Notas en vivo**: tras cada frase se anota solo lo relevante: 💡 idea, ✅ pendiente, 📌 decisión, 🔁 retoma de un pendiente anterior, ❓ pregunta abierta. La charla trivial se ignora. *Notas en vivo* y *Mis frases* activan o desactivan las notas de cada fuente.
- **📝 Resumir**: genera título, resumen, temas, ideas, decisiones, pendientes nuevos (con responsable), pendientes anteriores que se dieron por cerrados, próximos pasos y próximas iniciativas. Se escribe en la carpeta de la conversación y se guarda en la memoria. Resumir otra vez la misma sesión reemplaza el resumen anterior.
- **⏹ Terminar**: cierra la reunión sin perder lo último que se dijo. Fuerza el cierre de la frase en curso, deja de escuchar, resume, guarda transcripción y memoria y deja la pantalla lista para la siguiente conversación. Si el resumen falla, la transcripción queda en pantalla para reintentar con 📝 Resumir.
- **🧠 Memoria** (`userData/parakeet-memory.json`): pendientes abiertos (marcar como hecho o eliminar), completados y conversaciones anteriores. Los pendientes abiertos y los últimos resúmenes se envían como contexto a las notas en vivo y al resumen siguiente, así el asistente sabe qué quedó pendiente. **💡 Proponer próximos pasos** sugiere prioridades, acciones, iniciativas y temas para retomar a partir de la memoria.
- En ⚙ Configuración, *Contexto de las conversaciones* (opcional) describe quién participa y de qué se trata.

> Cada conexión de voz solo oye su propia fuente: las notas de 🖥 ven lo que dicen los demás y las de 🎙 lo que dices tú. El resumen sí usa la conversación completa.

## Sesiones guardadas

### Una carpeta por conversación
Cada sesión (reunión o entrevista) se guarda en su propia carpeta dentro de `transcripciones/`. La carpeta se crea con la fecha y hora de inicio y, al resumir, se renombra agregando el título:

```
transcripciones/2026-11-19_20-00-00_viaje-a-pucon/
  transcripcion.md    transcripción + notas en vivo (o respuestas sugeridas)
  resumen.md          resumen, temas y decisiones
  pendientes.md       nuevos, cerrados y los que siguen abiertos de antes
  ideas.md            ideas que surgieron + iniciativas propuestas
  proximos-pasos.md   próximos pasos
  reunion.json        todo lo anterior en formato estructurado
```

- En desarrollo: `<repo>/transcripciones/` (ignorada por git). En la app empaquetada: `Documentos\ParakeetAI\transcripciones`, fuera de la carpeta de la app, para que reinstalar no la borre.
- La transcripción se guarda sola cada 20 s, al pulsar **Limpiar** (que además empieza una sesión nueva) y al salir.
- En las entrevistas solo se crea `transcripcion.md`.
- Las sesiones antiguas guardadas como un único `.md` siguen funcionando.

### 📚 Historial
Botón 📚 en la barra (en ambos modos) o *Ver historial completo* en 🧠 Memoria.

- Lista todas las sesiones guardadas, de la más reciente a la más antigua, con etiquetas *Reunión* / *Entrevista*, *sin resumen* y *en curso*.
- Buscador por título, resumen y transcripción completa (sin distinguir mayúsculas ni tildes).
- Visor con pestañas: Resumen, Pendientes, Ideas, Próximos pasos y Transcripción.
- **📝 Resumir** las reuniones que quedaron sin resumen (por ejemplo, una que se cerró sin pulsar Resumir); el resultado queda en su carpeta y en la memoria como si se hubiera resumido en vivo. Un log antiguo de un solo `.md` se mueve primero a su propia carpeta.
- **📂 Abrir carpeta** abre la carpeta de la conversación; **📂 Carpetas** abre `transcripciones/`.

## Empaquetado
- **Windows**: `npm run dist:win` genera `dist/ParakeetAI-win32-x64/ParakeetAI.exe` y un `.zip`. El `.env` de la raíz va incluido, así que el zip lleva tus claves: compártelo solo en privado. `Iniciar ParakeetAI.cmd` arranca la versión de desarrollo.
- **macOS**: carpeta `mac/` con instalador (`Instalar ParakeetAI.command`) e instrucciones en `mac/LEEME.txt`. La primera vez hay que conceder *Grabación de pantalla y audio del sistema* y el micrófono, y reabrir la app.

## Estructura
| archivo | qué |
|---|---|
| `src/main.js` | proceso principal: ventana, bandeja, atajos, IPC, guardado de sesiones y memoria |
| `src/preload.js` | puente seguro (`window.api`) entre el renderer y el proceso principal |
| `src/llm.js` | prompts y llamadas al LLM: respuestas, notas, resúmenes, traducción, práctica |
| `src/meetingMemory.js` | memoria de reuniones: pendientes, resúmenes, contexto para el LLM |
| `src/sessionFiles.js` | nombre de la carpeta de sesión y contenido de resumen/pendientes/ideas/próximos pasos |
| `src/history.js` | listado, búsqueda y lectura de sesiones guardadas |
| `src/transcriptLog.js` | `transcripcion.md` de cada sesión (y su lectura inversa) |
| `src/renderer/` | interfaz: `index.html`, `renderer.js`, cliente STT (`deepgram.js`), worklet de audio |
| `test/` | tests con `node:test` |

## Límites conocidos
- Solo dos conexiones de voz a la vez (sistema + micrófono); la práctica de entrevista detiene la escucha.
- No identifica a cada participante: la transcripción distingue solo *Yo* (micrófono) y *Otros* / *Entrevistador* (audio del sistema).
- Las notas en vivo de cada fuente no ven la otra (ver arriba).
- Si el sistema reproduce el audio en modo exclusivo, el loopback puede no captarlo.

## Siguientes pasos
- Separar participantes (diarización) en el audio del sistema.
- Exportar resúmenes y pendientes (correo, calendario, gestores de tareas).
- Fallback de STT local (whisper.cpp) si la puerta de voz no está disponible.
