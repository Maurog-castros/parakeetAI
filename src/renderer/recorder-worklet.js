// Forwards mono Float32 audio blocks from the audio thread to the main thread.
class RecorderWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // copy; the underlying buffer is reused by the engine
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('recorder-worklet', RecorderWorklet);
