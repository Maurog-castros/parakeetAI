// Deepgram realtime STT over WebSocket (native browser WS, auth via subprotocol).
window.DG = {
  ws: null,
  onFinal: null,     // (text) committed chunk
  onInterim: null,   // (text) live partial
  onUtterance: null, // () end of utterance (speech_final)
  onStatus: null,    // (msg, isError)

  open(key, model, lang) {
    const p = new URLSearchParams({
      model: model || 'nova-2',
      language: lang || 'es',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
    });
    const ws = new WebSocket('wss://api.deepgram.com/v1/listen?' + p.toString(), ['token', key]);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { console.log('[dg] open'); this.onStatus && this.onStatus('escuchando (deepgram)'); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'UtteranceEnd') { this.onUtterance && this.onUtterance(); return; }
      if (m.type !== 'Results') return;
      const alt = m.channel && m.channel.alternatives && m.channel.alternatives[0];
      const t = alt && alt.transcript;
      if (!t) return;
      if (m.is_final) { console.log('[dg] final', JSON.stringify(t)); this.onFinal && this.onFinal(t); }
      else { this.onInterim && this.onInterim(t); }
      if (m.speech_final) { this.onUtterance && this.onUtterance(); }
    };
    ws.onerror = () => { console.error('[dg] ws error'); this.onStatus && this.onStatus('Deepgram: error de conexión', true); };
    ws.onclose = (e) => { console.log('[dg] close', e.code, e.reason); if (e.code !== 1000) this.onStatus && this.onStatus('Deepgram cerrado (' + e.code + ')', true); };
    this.ws = ws;
  },

  send(int16Buffer) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(int16Buffer);
  },

  close() {
    try {
      if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      this.ws && this.ws.close(1000);
    } catch (_) {}
    this.ws = null;
  },
};
console.log('[dg] module loaded');
