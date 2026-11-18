// Realtime STT over a Deepgram-compatible WebSocket (native browser WS, auth via
// subprotocol). Default target is the iamiko voice gateway, which also pushes
// its own "Suggestion" messages (start/delta/end) on the same socket.
// createSTT(tag) returns an independent connection: the live view uses two at
// once (interviewer = system audio, you = microphone); the gateway allows 2.
// If the socket drops while wanted (gateway restart 1012, idle 1011, network),
// it reconnects by itself with backoff and re-sends the last Configure.
window.createSTT = function createSTT(tag) {
  const log = (...a) => console.log('[' + tag + ']', ...a);
  const RETRY_MS = [1000, 2000, 4000, 8000, 15000];
  return {
    ws: null,
    onFinal: null,      // (text) committed chunk
    onInterim: null,    // (text) live partial
    onUtterance: null,  // () end of utterance (speech_final)
    onStatus: null,     // (msg, isError)
    onSuggestion: null, // (msg) gateway Suggestion {status, id, delta|suggestion|message, transcript}
    onReconnect: null,  // ('reconnecting', code, delayMs) | ('open')

    // suggest: 'off' (text only) | 'auto' | 'manual' — gateway-side suggestions.
    open(url, key, model, lang, suggest) {
      this.close();
      this._config = null;
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
        suggest: suggest || 'off',
      });
      this._url = (url || 'wss://stt.iamiko.cl/v1/listen') + '?' + p.toString();
      this._key = key;
      this._want = true;
      this._attempt = 0;
      this._connect();
    },

    _connect() {
      clearTimeout(this._retry);
      const ws = new WebSocket(this._url, ['token', this._key]);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        // Gateway closes after 30 s without audio; KeepAlive at least every 10 s.
        this._ka = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'KeepAlive' })); }, 8000);
        if (this._config) ws.send(JSON.stringify(this._config));
        log('open');
        if (this._attempt > 0) { this._attempt = 0; this.onReconnect && this.onReconnect('open'); }
        else this.onStatus && this.onStatus('escuchando');
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.type === 'Suggestion') { this.onSuggestion && this.onSuggestion(m); return; }
        if (m.type === 'Configured') { log('configured', JSON.stringify(m)); return; }
        if (m.type === 'Error') { console.error('[' + tag + '] error', JSON.stringify(m)); return; } // close + reconnect follow
        if (m.type === 'UtteranceEnd') { this.onUtterance && this.onUtterance(); return; }
        if (m.type !== 'Results') return;
        const alt = m.channel && m.channel.alternatives && m.channel.alternatives[0];
        const t = alt && alt.transcript;
        if (!t) return;
        if (m.is_final) { log('final', JSON.stringify(t)); this.onFinal && this.onFinal(t); }
        else { this.onInterim && this.onInterim(t); }
        if (m.speech_final) { this.onUtterance && this.onUtterance(); }
      };
      ws.onerror = () => { console.error('[' + tag + '] ws error'); };
      ws.onclose = (e) => {
        clearInterval(this._ka);
        log('close', e.code, e.reason);
        if (this.ws !== ws || !this._want) return; // closed on purpose
        const delay = RETRY_MS[Math.min(this._attempt, RETRY_MS.length - 1)];
        this._attempt++;
        this.onReconnect && this.onReconnect('reconnecting', e.code, delay);
        this._retry = setTimeout(() => { if (this._want && this.ws === ws) this._connect(); }, delay);
      };
      this.ws = ws;
    },

    // Configure message (instructions/context/...): sent now if open, else on (re)open.
    configure(msg) {
      this._config = msg;
      if (msg && this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
    },

    // Control message (Suggest, Finalize, Cancel…); dropped if not connected.
    control(type) {
      if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify({ type })); return true; }
      return false;
    },

    send(int16Buffer) {
      if (this.ws && this.ws.readyState === 1) this.ws.send(int16Buffer);
    },

    close() {
      this._want = false;
      clearTimeout(this._retry);
      clearInterval(this._ka);
      const ws = this.ws;
      this.ws = null;
      try {
        if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'CloseStream' }));
        ws && ws.close(1000);
      } catch (_) {}
    },
  };
};
window.DG = window.createSTT('dg'); // practice mode (microphone, text only)
console.log('[dg] module loaded');
