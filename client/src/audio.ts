export class SoundEngine {
  private ctx: AudioContext | null = null;
  private unlocked = false;

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.unlocked = true;
  }

  private playTone(freqStart: number, freqEnd: number, dur: number, type: OscillatorType, gainAmt: number) {
    if (!this.ctx || !this.unlocked) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    gain.gain.setValueAtTime(gainAmt, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  private playNoise(dur: number, filterHz: number, gainAmt: number) {
    if (!this.ctx || !this.unlocked) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;

    const gain = this.ctx.createGain();
    const t = this.ctx.currentTime;
    gain.gain.setValueAtTime(gainAmt, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start(t);
  }

  swing() {
    this.playNoise(0.11, 900, 0.12);
    this.playTone(220, 90, 0.1, 'triangle', 0.08);
  }

  hit(isZombie = true) {
    this.playNoise(0.09, isZombie ? 600 : 1200, 0.18);
    this.playTone(isZombie ? 130 : 190, 50, 0.12, 'sawtooth', 0.14);
  }

  shot(isShotgun = false) {
    this.playNoise(isShotgun ? 0.32 : 0.18, isShotgun ? 1800 : 2600, isShotgun ? 0.35 : 0.25);
    this.playTone(isShotgun ? 160 : 280, 45, isShotgun ? 0.25 : 0.14, 'square', 0.16);
  }

  loot() {
    this.playTone(520, 780, 0.09, 'sine', 0.09);
  }

  click() {
    this.playTone(680, 440, 0.04, 'triangle', 0.06);
  }
}
