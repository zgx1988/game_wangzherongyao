export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  public bgmVolume = 0.42;
  public sfxVolume = 0.72;
  public voiceEnabled = true;
  public muted = false;

  private bgmMode: 'none' | 'lobby' | 'battle' = 'none';
  private bgmTimer: number | null = null;
  private bgmStep = 0;
  private lastVoiceTime = 0;

  public unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 1;
      this.masterGain.connect(this.ctx.destination);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = this.bgmVolume;
      this.bgmGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(this.masterGain);

      // Generate reusable filtered noise buffer for slashes/explosions/drums
      const sampleRate = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, sampleRate * 1.5, sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setVolumes(bgm: number, sfx: number, voice: boolean): void {
    this.bgmVolume = bgm;
    this.sfxVolume = sfx;
    this.voiceEnabled = voice;
    if (this.bgmGain && this.ctx) {
      this.bgmGain.gain.setTargetAtTime(bgm, this.ctx.currentTime, 0.05);
    }
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    }
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.04);
    }
    return this.muted;
  }

  public startBgm(mode: 'lobby' | 'battle'): void {
    if (this.bgmMode === mode) return;
    this.stopBgm();
    this.bgmMode = mode;
    this.bgmStep = 0;
    const tempoMs = mode === 'lobby' ? 375 : 230;
    this.bgmTimer = window.setInterval(() => this.tickBgm(), tempoMs);
  }

  public stopBgm(): void {
    this.bgmMode = 'none';
    if (this.bgmTimer !== null) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  // Eastern D-minor Pentatonic scale frequencies (D, F, G, A, C)
  private tickBgm(): void {
    if (!this.ctx || !this.bgmGain || this.ctx.state !== 'running' || this.muted || this.bgmVolume <= 0.01) {
      return;
    }
    const now = this.ctx.currentTime;
    const step = this.bgmStep++;

    if (this.bgmMode === 'lobby') {
      // Heroic serene Guzheng arpeggios + warm atmospheric drone + bamboo flute
      const melody = [
        293.66, 0, 440.0, 523.25, 587.33, 0, 523.25, 440.0,
        349.23, 0, 440.0, 587.33, 659.25, 587.33, 440.0, 0,
        392.0, 0, 523.25, 587.33, 698.46, 0, 587.33, 523.25,
        440.0, 0, 392.0, 349.23, 293.66, 0, 0, 0,
      ];
      const note = melody[step % melody.length];
      if (note > 0) {
        this.playGuzheng(note, now, 0.24, 1.4);
        if (step % 8 === 0) this.playGuzheng(note * 0.5, now, 0.18, 2.0);
      }
      // Deep warm pad chord every 8 steps
      if (step % 8 === 0) {
        const roots = [146.83, 116.54, 130.81, 110.0];
        const root = roots[Math.floor(step / 8) % roots.length];
        this.playPad(root, now, 2.8, 0.14);
        this.playPad(root * 1.5, now, 2.8, 0.09);
      }
      if (step % 16 === 0) {
        this.playTaiko(now, 0.22);
      }
    } else if (this.bgmMode === 'battle') {
      // Intense war drums + heroic plucked strings + brass horn swells!
      const drumPattern = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1];
      if (drumPattern[step % 16]) {
        this.playTaiko(now, step % 4 === 0 ? 0.34 : 0.2);
      }
      if (step % 4 === 2) {
        this.playRimClick(now, 0.08);
      }

      const riff = [
        293.66, 293.66, 349.23, 440.0, 587.33, 0, 523.25, 440.0,
        392.0, 0, 440.0, 349.23, 293.66, 0, 261.63, 293.66,
        440.0, 0, 523.25, 587.33, 698.46, 0, 587.33, 523.25,
        587.33, 523.25, 440.0, 392.0, 440.0, 0, 0, 0,
      ];
      const n = riff[step % riff.length];
      if (n > 0) {
        this.playGuzheng(n, now, 0.2, 0.7);
      }

      if (step % 16 === 0) {
        const bass = [73.42, 58.27, 65.41, 82.41][Math.floor(step / 16) % 4];
        this.playPad(bass, now, 3.2, 0.22);
        this.playPad(bass * 2, now, 3.2, 0.12);
      }
    }
  }

  private playGuzheng(freq: number, time: number, vol: number, dur: number): void {
    if (!this.ctx || !this.bgmGain) return;
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc2.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 2.003, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(freq * 6, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.4, time + dur);

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + dur);

    const g2 = this.ctx.createGain();
    g2.gain.value = 0.22;

    osc.connect(filter);
    osc2.connect(g2);
    g2.connect(filter);
    filter.connect(gain);
    gain.connect(this.bgmGain);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + dur + 0.05);
    osc2.stop(time + dur + 0.05);
  }

  private playPad(freq: number, time: number, dur: number, vol: number): void {
    if (!this.ctx || !this.bgmGain) return;
    const osc = this.ctx.createOscillator();
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    filter.type = 'lowpass';
    filter.frequency.value = 460;

    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  private playTaiko(time: number, vol: number): void {
    if (!this.ctx || !this.bgmGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(125, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.28);

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.38);

    osc.connect(gain);
    gain.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.4);
  }

  private playRimClick(time: number, vol: number): void {
    if (!this.ctx || !this.bgmGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1850;
    filter.Q.value = 3;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.bgmGain);
    src.start(time);
    src.stop(time + 0.07);
  }

  public playSfx(kind: string): void {
    if (this.muted || this.sfxVolume <= 0.01) return;
    this.unlock();
    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;

    switch (kind) {
      case 'sword_slash':
        this.noiseBurst(now, 0.14, 1600, 420, 0.32);
        this.tone(now, 'triangle', 680, 220, 0.11, 0.18);
        break;
      case 'heavy_slash':
        this.noiseBurst(now, 0.24, 1200, 220, 0.46);
        this.tone(now, 'sawtooth', 320, 95, 0.22, 0.28);
        this.tone(now, 'sine', 130, 45, 0.26, 0.35);
        break;
      case 'bow':
        this.tone(now, 'triangle', 520, 1280, 0.09, 0.22);
        this.noiseBurst(now + 0.02, 0.1, 3200, 1400, 0.16);
        break;
      case 'magic_shoot':
        this.tone(now, 'sine', 920, 1480, 0.12, 0.18);
        this.tone(now + 0.03, 'triangle', 1320, 880, 0.12, 0.14);
        break;
      case 'magic_wave':
        this.tone(now, 'sine', 520, 1080, 0.25, 0.22);
        this.noiseBurst(now, 0.26, 2200, 600, 0.22);
        break;
      case 'charm':
        this.tone(now, 'sine', 880, 1320, 0.18, 0.2);
        this.tone(now + 0.07, 'sine', 1175, 1760, 0.22, 0.22);
        break;
      case 'dash':
      case 'flash':
        this.noiseBurst(now, 0.18, 3400, 500, 0.32);
        this.tone(now, 'sine', 420, 980, 0.14, 0.22);
        break;
      case 'sword_ring':
        this.tone(now, 'triangle', 1046, 523, 0.32, 0.24);
        this.tone(now + 0.04, 'sine', 1568, 784, 0.34, 0.18);
        break;
      case 'libai_ult':
        for (let i = 0; i < 5; i++) {
          this.noiseBurst(now + i * 0.12, 0.11, 2400 - i * 180, 600, 0.34);
          this.tone(now + i * 0.12, 'sawtooth', 980 + i * 120, 320, 0.1, 0.18);
        }
        break;
      case 'phoenix_ult':
        this.tone(now, 'sawtooth', 620, 1380, 0.35, 0.26);
        this.tone(now + 0.12, 'triangle', 1240, 540, 0.45, 0.24);
        this.noiseBurst(now, 0.5, 1800, 400, 0.34);
        break;
      case 'solar_hit':
        this.tone(now, 'sine', 240, 65, 0.32, 0.42);
        this.noiseBurst(now, 0.28, 1600, 300, 0.32);
        break;
      case 'ult_charge':
        this.tone(now, 'sawtooth', 140, 520, 0.55, 0.24);
        break;
      case 'ult_slam':
      case 'turret_destroy':
        this.tone(now, 'sine', 155, 32, 0.65, 0.58);
        this.noiseBurst(now, 0.6, 950, 120, 0.52);
        this.tone(now + 0.05, 'triangle', 320, 75, 0.42, 0.26);
        break;
      case 'skill_holy':
      case 'heal':
      case 'buff':
        this.tone(now, 'sine', 523.25, 659.25, 0.22, 0.2);
        this.tone(now + 0.08, 'sine', 659.25, 1046.5, 0.28, 0.2);
        break;
      case 'recall':
        this.tone(now, 'sine', 440, 880, 0.45, 0.18);
        this.tone(now + 0.12, 'triangle', 659, 1318, 0.45, 0.14);
        break;
      case 'smite':
        this.noiseBurst(now, 0.2, 4200, 500, 0.42);
        this.tone(now, 'sawtooth', 880, 120, 0.22, 0.32);
        break;
      case 'turret_lock':
        this.tone(now, 'square', 980, 980, 0.08, 0.2);
        this.tone(now + 0.11, 'square', 1240, 1240, 0.09, 0.22);
        break;
      case 'turret_fire':
        this.tone(now, 'sawtooth', 480, 160, 0.18, 0.2);
        break;
      case 'coin':
        this.tone(now, 'sine', 1318, 1318, 0.07, 0.18);
        this.tone(now + 0.06, 'sine', 1760, 1760, 0.14, 0.2);
        break;
      case 'buy_item':
        this.tone(now, 'triangle', 659, 880, 0.1, 0.2);
        this.tone(now + 0.08, 'triangle', 988, 1318, 0.18, 0.24);
        break;
      case 'level_up':
      case 'skill_up':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone(now + i * 0.065, 'triangle', f, f, 0.22, 0.2);
        });
        break;
      case 'ping':
        this.tone(now, 'sine', 1046, 1568, 0.16, 0.22);
        break;
      case 'kill':
      case 'first_blood':
      case 'double_kill':
      case 'triple_kill':
      case 'quadra_kill':
      case 'penta_kill':
      case 'killing_spree':
      case 'godlike':
      case 'legendary':
      case 'shutdown':
      case 'ace':
      case 'boss_kill':
      case 'boss_spawn':
        this.playFanfare(now, kind === 'penta_kill' || kind === 'first_blood' ? 1.2 : 0.9);
        break;
      case 'victory':
        [293.66, 369.99, 440.0, 587.33, 739.99, 880.0].forEach((f, i) => {
          this.tone(now + i * 0.1, 'triangle', f, f, 0.6, 0.26);
        });
        break;
      case 'ui_click':
        this.tone(now, 'sine', 740, 960, 0.06, 0.14);
        break;
    }
  }

  private playFanfare(now: number, intensity: number): void {
    const notes = [440, 587.33, 659.25, 880];
    notes.forEach((f, i) => {
      this.tone(now + i * 0.08, 'sawtooth', f, f, 0.32, 0.14 * intensity);
      this.tone(now + i * 0.08, 'triangle', f * 0.5, f * 0.5, 0.4, 0.16 * intensity);
    });
  }

  private tone(
    time: number,
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    dur: number,
    vol: number
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, time);
    if (startFreq !== endFreq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + dur);
    }
    gain.gain.setValueAtTime(0.001, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private noiseBurst(
    time: number,
    dur: number,
    startFreq: number,
    endFreq: number,
    vol: number
  ): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(startFreq, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, endFreq), time + dur);
    filter.Q.value = 1.6;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(time);
    src.stop(time + dur + 0.03);
  }

  public announceVoice(text: string): void {
    if (this.muted || !this.voiceEnabled || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }
    const now = performance.now();
    if (now - this.lastVoiceTime < 1400) return;
    this.lastVoiceTime = now;

    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'zh-CN';
      utter.rate = 1.06;
      utter.pitch = 0.96;
      utter.volume = Math.min(1, this.sfxVolume + 0.15);
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors on restricted platforms
    }
  }
}

export const soundEngine = new SoundEngine();
