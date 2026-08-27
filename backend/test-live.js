import { LiveMonitoringService } from './dist/services/live.js';
const s = new LiveMonitoringService();
s.tick().then(() => s.refreshTraffic()).then(() => console.log(s.devices.map(d => d.latest))).catch(console.error);
