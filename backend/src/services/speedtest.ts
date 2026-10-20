export class SpeedTestService {
  private lastResult: { downloadMbps: number; uploadMbps: number; timestamp: string } | null = null;
  private isRunning = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private controller: AbortController | null = null;

  constructor() {
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runTest();
    }, 5000);
    this.startInterval(30 * 60 * 1000);
  }

  startInterval(ms: number) {
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = setInterval(() => this.runTest(), ms);
  }

  stop() {
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
    this.controller?.abort();
    this.controller = null;
  }

  async runTest() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.controller = new AbortController();
    try {
      console.log('Running internet speed test (this takes a few seconds)...');
      
      const dlBytes = 25000000;
      const dlStart = performance.now();
      const dlRes = await fetch(`https://speed.cloudflare.com/__down?bytes=${dlBytes}`, { signal: this.controller.signal });
      if (!dlRes.ok) throw new Error(`Download test returned HTTP ${dlRes.status}`)
      await dlRes.arrayBuffer();
      const dlEnd = performance.now();
      const dlDurationSec = (dlEnd - dlStart) / 1000;
      const downloadMbps = (dlBytes * 8 / 1000000) / dlDurationSec;

      const ulBytes = 5000000;
      const payload = new Uint8Array(ulBytes);
      const ulStart = performance.now();
      const ulRes = await fetch('https://speed.cloudflare.com/__up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload,
        signal: this.controller.signal
      });
      if (!ulRes.ok) throw new Error(`Upload test returned HTTP ${ulRes.status}`)
      const ulEnd = performance.now();
      const ulDurationSec = (ulEnd - ulStart) / 1000;
      const uploadMbps = (ulBytes * 8 / 1000000) / ulDurationSec;

      this.lastResult = {
        downloadMbps: Number(downloadMbps.toFixed(1)),
        uploadMbps: Number(uploadMbps.toFixed(1)),
        timestamp: new Date().toISOString()
      };
      console.log('Internet speed test complete: ', this.lastResult.downloadMbps, 'Mbps down / ', this.lastResult.uploadMbps, 'Mbps up');
    } catch (e) {
      console.error('Internet speed test failed:', e instanceof Error ? e.message : e);
    } finally {
      this.isRunning = false;
      this.controller = null;
    }
  }

  getLatestResult() {
    return this.lastResult;
  }
}

export const speedTestService = new SpeedTestService();
