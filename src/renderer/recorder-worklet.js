// Audio thread: turns the mono Float32 input into ready-to-send Int16 frames
// (~200 ms, transferred without copying) plus a level reading every ~100 ms.
// The engine calls process() every 128 samples; posting each of those blocks
// woke the page ~125 times a second per source and kept the CPU busy (slow
// Macs during long meetings).
class RecorderWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.frame = o.frameSamples || 3200;
    this.levelEvery = o.levelSamples || 1600;
    this.buf = new Int16Array(this.frame);
    this.n = 0;
    this.sum = 0;
    this.count = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      let v = ch[i];
      v = v < -1 ? -1 : v > 1 ? 1 : v;
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      this.sum += v * v;
      if (this.n === this.frame) {
        const out = this.buf.buffer;
        this.port.postMessage({ pcm: out }, [out]);
        this.buf = new Int16Array(this.frame);
        this.n = 0;
      }
    }
    this.count += ch.length;
    if (this.count >= this.levelEvery) {
      this.port.postMessage({ level: Math.sqrt(this.sum / this.count) });
      this.sum = 0;
      this.count = 0;
    }
    return true;
  }
}
registerProcessor('recorder-worklet', RecorderWorklet);
