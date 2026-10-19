const batchSamples = 8000;

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batch = new Int16Array(batchSamples);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      for (let index = 0; index < channel.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, channel[index]));
        this.batch[this.filled] =
          sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        this.filled += 1;
        if (this.filled === batchSamples) {
          this.port.postMessage(this.batch, [this.batch.buffer]);
          this.batch = new Int16Array(batchSamples);
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
