import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { SimulationService } from './services/simulation.js'
import { LiveMonitoringService } from './services/live.js'
import { speedTestService } from './services/speedtest.js'
import { pearson, statistics } from './services/statistics.js'
import { settingsService } from './services/settings.js'

const app = express()
const port = Number(process.env.PORT || 4000)
let simulationMode = process.env.SIMULATION_MODE === 'true'
let monitor: SimulationService | LiveMonitoringService = simulationMode ? new SimulationService() : new LiveMonitoringService()
const secret = process.env.JWT_SECRET || 'development-only-change-me'

app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }))
app.use(express.json())
const dashboard = () => {
  const devices = monitor.devices;
  const latest = devices.map(d => d.latest);
  const avg = (fn: (m: typeof latest[number]) => number) => latest.reduce((s, m) => s + fn(m), 0) / Math.max(latest.length, 1);
  const availability = avg(m => m.availabilityPercent);
  const latency = avg(m => m.latencyMs);
  const loss = avg(m => m.packetLossPercent);
  const download = avg(m => m.downloadMbps);
  const upload = avg(m => m.uploadMbps);
  const errors = avg(m => m.errorCount);

  const speed = !simulationMode ? speedTestService.getLatestResult() : null;
  const displayDownload = speed ? speed.downloadMbps : download;
  const displayUpload = speed ? speed.uploadMbps : upload;

  const factors = {
    availability: availability,
    latency: Math.max(0, 100 - latency / 1.8),
    packetLoss: Math.max(0, 100 - loss * 15),
    bandwidth: Math.min(100, displayDownload / 1.1),
    errorRate: Math.max(0, 100 - errors * 20)
  };
  const score = Object.entries(factors).reduce((s, [k, v]) => s + v * ({ availability: .3, latency: .2, packetLoss: .2, bandwidth: .2, errorRate: .1 }[k as keyof typeof factors]), 0);
  const kpi = (value: number, previous: number, unit: string) => ({ value: +value.toFixed(1), previous: +previous.toFixed(1), unit, trend: Array.from({ length: 12 }, (_, i) => +(value * (.92 + Math.sin(i * .8) * .06)).toFixed(1)) });
  const all = monitor.metrics.get(1) || [];
  const traffic = all.slice(-24);
  const problematic = devices.map(d => {
    const m = d.latest;
    const active = monitor.alerts.filter(a => a.deviceId === d.id && a.status === 'active').length;
    const risk = Math.min(100, (100 - m.availabilityPercent) * .3 + m.latencyMs * .25 + m.packetLossPercent * 10 + Math.max(0, 60 - m.downloadMbps) * .35 + active * 12);
    return { device: d, score: +risk.toFixed(0), level: risk > 65 ? 'Critical' : risk > 35 ? 'Warning' : 'Healthy' }
  }).sort((a, b) => b.score - a.score);

  return {
    mode: simulationMode ? 'simulation' : 'live',
    generatedAt: new Date().toISOString(),
    kpis: {
      totalDevices: kpi(devices.length, devices.length - 1, ''),
      onlineDevices: kpi(devices.filter(d => d.status === 'online').length, devices.length - 1, ''),
      offlineDevices: kpi(devices.filter(d => d.status === 'offline').length, 1, ''),
      averageLatency: kpi(latency, latency * 1.08, 'ms'),
      packetLoss: kpi(loss, loss * .87, '%'),
      availability: kpi(availability, availability - .5, '%'),
      download: kpi(download, download * .95, 'Mbps'),
      upload: kpi(upload, upload * 1.05, 'Mbps')
    },
    capacity: speed ? { download: speed.downloadMbps, upload: speed.uploadMbps } : null,
    health: { score: +score.toFixed(0), status: score >= 90 ? 'Excellent' : score >= 75 ? 'Healthy' : score >= 55 ? 'Warning' : 'Critical', explanation: score >= 90 ? 'All monitored indicators are within target ranges.' : 'One or more indicators need attention.', factors },
    traffic, devices, alerts: monitor.alerts.slice(0, 20), problematic
  };
}
app.post('/api/auth/login',async(req,res,next)=>{try{const body=z.object({email:z.string().email(),password:z.string().min(1)}).parse(req.body);const demoEmail='admin@network.local',hash=await bcrypt.hash('admin123',10);if(body.email!==demoEmail||!(await bcrypt.compare(body.password,hash)))return res.status(401).json({message:'Invalid credentials'});res.json({token:jwt.sign({role:'admin',email:body.email},secret,{expiresIn:'8h'}),user:{name:'Admin User',role:'admin'}})}catch(e){next(e)}})
app.get('/api/dashboard',async(_req,res,next)=>{try{if(monitor instanceof LiveMonitoringService)await monitor.refreshTraffic();res.json(dashboard())}catch(e){next(e)}});
app.get('/api/devices',(_req,res)=>res.json(monitor.devices));
app.get('/api/hotspot/clients', async (_req, res, next) => {
  try {
    if (!(monitor instanceof LiveMonitoringService)) return res.json({ enabled: false, captureActive: false, message: 'Hotspot client traffic is available only in Live Mode.', clients: [] })
    res.json(await monitor.getHotspotSnapshot())
  } catch (error) { next(error) }
});
app.post('/api/devices',(req,res,next)=>{try{const body=z.object({name:z.string().min(2).max(80),address:z.string().min(2).max(253),type:z.string().optional(),location:z.string().optional(),monitoringInterval:z.number().int().min(5).max(3600).optional()}).parse(req.body);res.status(201).json(monitor.addDevice(body))}catch(e){next(e)}});
app.get('/api/devices/:id',(req,res,next)=>{try{res.json(monitor.getDevice(+req.params.id))}catch(e){next(e)}})
app.get('/api/monitoring/:deviceId',(req,res)=>res.json(monitor.metrics.get(+req.params.deviceId)||[]));
app.get('/api/monitoring/:deviceId/latest',(req,res,next)=>{try{res.json(monitor.getDevice(+req.params.deviceId).latest)}catch(e){next(e)}})
app.post('/api/monitoring/check/:deviceId',async(req,res,next)=>{try{res.json(await monitor.check(+req.params.deviceId))}catch(e){next(e)}})
app.get('/api/analytics/:deviceId/statistics',(req,res,next)=>{try{const records=monitor.metrics.get(+req.params.deviceId);if(!records)throw Object.assign(new Error('Device not found'),{status:404});const metric=String(req.query.metric||'latencyMs') as keyof typeof records[number];if(!['latencyMs','packetLossPercent','downloadMbps','uploadMbps','availabilityPercent'].includes(metric))throw Object.assign(new Error('Unsupported metric'),{status:400});res.json({...statistics(records,metric,String(req.query.method||'zscore')),correlation:pearson(records)})}catch(e){next(e)}})
app.get('/api/analytics/:deviceId/anomalies',(req,res,next)=>{try{const records=monitor.metrics.get(+req.params.deviceId)||[];res.json(statistics(records,'latencyMs',String(req.query.method||'zscore')).anomalies)}catch(e){next(e)}})
app.get('/api/alerts',(_req,res)=>res.json(monitor.alerts));
app.put('/api/alerts/:id/:action',(req,res,next)=>{try{const action=z.enum(['acknowledge','resolve']).parse(req.params.action);res.json(monitor.updateAlert(+req.params.id,action==='acknowledge'?'acknowledged':'resolved'))}catch(e){next(e)}})
app.post('/api/simulation/run',async(_req,res,next)=>{try{await monitor.runScenario();res.json(dashboard())}catch(e){next(e)}});
app.get('/api/reports/:period',(req,res)=>{const data=dashboard();const daily={title:`${req.params.period==='weekly'?'Weekly':'Daily'} network report`,generatedAt:data.generatedAt,networkAvailability:`${data.kpis.availability.value}%`,averageLatency:`${data.kpis.averageLatency.value} ms`,packetLoss:`${data.kpis.packetLoss.value}%`,averageDownload:`${data.kpis.download.value} Mbps`,activeAlerts:data.alerts.filter(a=>a.status==='active').length,topProblematicDevices:data.problematic.slice(0,3).map(x=>`${x.device.name} (${x.score})`).join(', ')};res.json({report:daily})});

app.get('/api/settings', (req, res) => res.json(settingsService.getSettings()));
app.put('/api/settings', async (req, res, next) => {
  try {
    const body = z.object({
      checkIntervalSeconds: z.number().int().min(5).max(3600),
      dashboardRefreshMode: z.string(),
      latencyThresholdMs: z.number().int().min(1).max(5000),
      displayName: z.string().min(1).max(100),
      email: z.string().email(),
      operatingMode: z.enum(['live', 'simulation'])
    }).parse(req.body);
    
    const oldMode = settingsService.getSettings().operatingMode;
    await settingsService.saveSettings(body);
    
    if (oldMode !== body.operatingMode) {
      simulationMode = body.operatingMode === 'simulation';
      monitor = simulationMode ? new SimulationService() : new LiveMonitoringService();
      void monitor.tick();
    }
    
    res.json(settingsService.getSettings());
  } catch (e) { next(e) }
});

import { ZodError } from 'zod';

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof ZodError) {
    const message = err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    res.status(400).json({ message: message || 'Validation failed', issues: err.issues });
    return;
  }
  const e = err as { status?: number; message?: string; issues?: unknown };
  console.error(err);
  res.status(e.status || 400).json({ message: e.message || 'Invalid request', issues: e.issues });
});

settingsService.loadSettings().then(() => {
  simulationMode = settingsService.getSettings().operatingMode === 'simulation';
  monitor = simulationMode ? new SimulationService() : new LiveMonitoringService();
  void monitor.tick(); 
  setInterval(() => void monitor.tick(), settingsService.getSettings().checkIntervalSeconds * 1000);
  app.listen(port, () => console.log(`Monitoring API listening on http://localhost:${port}`));
});
