# Plan: ingeniería inversa de ParakeetAI (con/sin GhidraMCP)

> Ámbito legal: RE para interoperabilidad, investigación de seguridad y aprendizaje.
> No eludir licencias/DRM ni robar credenciales/claves de API ajenas.

## Hecho clave
ParakeetAI = **app Electron** (Win/macOS) + versión web. Electron = **JS empaquetado**, no binario nativo.
GhidraMCP = analiza **binarios nativos** con Ghidra vía MCP (decompila, renombra, lista métodos/imports/exports).
=> El grueso de ParakeetAI NO es trabajo de Ghidra. Ghidra solo para las partes nativas.

| Capa | Qué es | Herramienta |
|------|--------|-------------|
| Lógica app | JS/TS en ASAR | asar, deobfuscador JS, DevTools |
| Runtime Electron | binario Chromium/Node | (no tocar, upstream) |
| Addons nativos | `.node`, DLLs propias | **GhidraMCP** |
| Backend/red | API HTTPS a OpenAI/Anthropic/Google vía su servidor | proxy MITM |

---

## Fase 0 — Setup
- [ ] Confirmar forma de distribución: bajar instalador oficial, ver si es Electron (carpeta `resources/app.asar`).
- [ ] VM aislada (Windows). Snapshot limpio.
- [ ] Instalar: Ghidra 12.1.4, GhidraMCP (plugin + server python, `uvx`), mitmproxy/Burp, Node, `npx asar`.
- [ ] Conectar GhidraMCP a tu cliente MCP (Claude Code: `claude mcp add`).

## Fase 1 — Recon estático (JS, lo primero)
- [ ] Localizar `app.asar` en `resources/`.
- [ ] `npx asar extract app.asar out/` → código fuente JS.
- [ ] Mapear: main process, preload, renderer. Buscar endpoints, claves, feature flags.
- [ ] Deobfuscar si minificado (webcrack / de4js). Sacar strings: dominios API, rutas.
- [ ] Identificar módulos nativos: `*.node` en `app.asar.unpacked/` o `node_modules`.

## Fase 2 — RE nativo con GhidraMCP
- [ ] Meter cada `.node`/DLL propia en Ghidra (headless: `ghidra-mcp --headless --binary <path>`).
- [ ] Vía MCP pedir: decompilar, listar exports/imports, renombrar funciones.
- [ ] Objetivo típico nativo: captura de audio de sistema, anti-detección, cifrado local, hooks de overlay.
- [ ] Documentar funciones exportadas que el JS llama (correlacionar con Fase 1).

## Fase 3 — Análisis dinámico
- [ ] Lanzar app bajo mitmproxy (instalar CA en VM). Ver tráfico real:
  - auth, endpoints de transcripción, prompts a LLM, formato de respuestas.
- [ ] DevTools del renderer (`--remote-debugging-port`) para inspeccionar runtime.
- [ ] Hookear funciones nativas clave (Frida) si hace falta confirmar comportamiento.

## Fase 4 — Síntesis
- [ ] Diagrama de arquitectura: audio -> transcripción -> detección pregunta -> LLM -> overlay.
- [ ] Documentar protocolo de red y rol de cada módulo nativo.
- [ ] Notas de seguridad/privacidad (qué envía, a dónde).

---

## Realidad sobre GhidraMCP aquí
- Útil SOLO para addons nativos / DLLs propias. Si ParakeetAI no trae nativo propio, Ghidra casi no se usa.
- El 80% del valor sale de: **asar extract + deobfusc JS + MITM de red**. Empezar por ahí.
- Confirmar Fase 0 antes de montar Ghidra; evita trabajo en vano.
