export class SpeedTestService {
  private lastResult: { downloadMbps: number; uploadMbps: number; timestamp: string } | null = null;
  private isRunning = false;

  constructor() {
    // Run the first test shortly after startup
    setTimeout(() => this.runTest(), 5000);
    
    // Run periodically every 30 minutes
    setInterval(() => this.runTest(), 30 * 60 * 1000);
  }

  async runTest() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      console.log('Running internet speed test (this takes a few seconds)...');
      
      // Download 25MB from Cloudflare edge
      const dlBytes = 25000000;
      const dlStart = performance.now();
      const dlRes = await fetch(`https://speed.cloudflare.com/__down?bytes=${dlBytes}`);
      await dlRes.arrayBuffer();
      const dlEnd = performance.now();
      const dlDurationSec = (dlEnd - dlStart) / 1000;
      const downloadMbps = (dlBytes * 8 / 1000000) / dlDurationSec;

      // Upload 5MB to Cloudflare edge
      const ulBytes = 5000000;
      const payload = new Uint8Array(ulBytes);
      const ulStart = performance.now();
      await fetch('https://speed.cloudflare.com/__up', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: payload
      });
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
    }
  }

  getLatestResult() {
    return this.lastResult;
  }
}

export const speedTestService = new SpeedTestService();
