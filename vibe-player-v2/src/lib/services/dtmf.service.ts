// vibe-player-v2/src/lib/services/dtmf.service.ts

import DtmfWorker from '$lib/workers/dtmf.worker?worker&inline';
import { dtmfStore } from '$lib/stores/dtmf.store';

class DtmfService {
  private static instance: DtmfService;
  private worker: Worker | null = null;

  private constructor() {}

  public static getInstance(): DtmfService {
    if (!DtmfService.instance) {
      DtmfService.instance = new DtmfService();
    }
    return DtmfService.instance;
  }

  public initialize(sampleRate: number): void {
    if (this.worker) {
      this.worker.terminate();
    }

    this.worker = new DtmfWorker();

    this.worker.onmessage = (event) => {
      const { type, payload, error } = event.data;
      if (type === 'init_complete') {
        dtmfStore.update(s => ({ ...s, status: 'idle', error: null }));
      } else if (type === 'result') {
        dtmfStore.update(s => ({ ...s, status: 'complete', dtmf: payload.dtmf, cpt: payload.cpt || [] }));
      } else if (type === 'error') {
        dtmfStore.update(s => ({ ...s, status: 'error', error: payload }));
      }
    };

    this.worker.postMessage({ type: 'init', payload: { sampleRate } });
  }

  public async process(audioBuffer: AudioBuffer): Promise<void> {
    if (!this.worker) {
      dtmfStore.update(s => ({ ...s, status: 'error', error: 'DTMF Worker not initialized.' }));
      return;
    }
    dtmfStore.update(s => ({ ...s, status: 'processing', dtmf: [], cpt: [] }));

    // We need to resample the audio to 16kHz for the Goertzel algorithm
    const targetSampleRate = 16000;
    const offlineCtx = new OfflineAudioContext(1, audioBuffer.duration * targetSampleRate, targetSampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start();

   try {
     const resampled = await offlineCtx.startRendering();
     const pcmData = resampled.getChannelData(0);
     this.worker?.postMessage({ type: 'process', payload: { pcmData } });
   } catch (e) {
     const error = e as Error;
     dtmfStore.update(s => ({ ...s, status: 'error', error: `Resampling failed: ${error.message}` }));
     // Re-throw the error so the caller (like a test) can know it failed.
     throw error;
   }
  }

  public dispose(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    console.log("DtmfService disposed.");
  }
}

export default DtmfService.getInstance();
