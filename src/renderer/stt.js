// Local speech-to-text using Transformers.js Whisper (runs in the renderer, no server).
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2';

env.allowLocalModels = false;           // always fetch from HF hub
env.backends.onnx.wasm.numThreads = 1;  // stability across machines

const LANG = { es: 'spanish', en: 'english', pt: 'portuguese', fr: 'french', de: 'german' };

let asr = null;
let readyP = null;

window.STT = {
  ready: false,
  async init(model, onStatus) {
    if (readyP) return readyP;
    readyP = (async () => {
      onStatus && onStatus('descargando modelo STT (' + model + ')…');
      console.log('[stt] downloading model', model);
      asr = await pipeline('automatic-speech-recognition', model, { quantized: true });
      window.STT.ready = true;
      console.log('[stt] ready');
      onStatus && onStatus('listo — pulsa Start');
    })();
    return readyP;
  },
  async transcribe(float32, langCode) {
    if (!asr) throw new Error('STT no iniciado');
    const out = await asr(float32, {
      language: LANG[langCode] || 'spanish',
      task: 'transcribe',
      chunk_length_s: 30,
    });
    return (out && out.text || '').trim();
  },
};

console.log('[stt] module loaded');
window.dispatchEvent(new Event('stt-loaded'));
