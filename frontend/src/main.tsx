import { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, Bell, ChevronRight, CircleAlert, Gauge, Laptop, Moon, Network, Play, Plus, Radio, Search, Server, Settings, Sun, User, Wifi } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from './api'
import type { Alert, Dashboard, Device, Metric, Statistics } from './types'
import './styles.css'

const fmt = (value: number, digits = 1) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)

const pretty = (value: string) =>
  value.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())

const date = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{status}</span>
}

function MiniTrend({ values }: { values: number[] }) {
  return (
    <ResponsiveContainer width="100%" height={38}>
      <LineChart data={values.map((value, i) => ({ i, value }))}>
        <Line
          type="monotone"
          dataKey="value"
          stroke="currentColor"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function DashboardPage({ data, onScenario }: { data: Dashboard; onScenario: () => void }) {
  const kpis = [
    ['totalDevices', Laptop, 'Total devices'], ['onlineDevices', Wifi, 'Online devices'], ['offlineDevices', CircleAlert, 'Offline devices'], ['averageLatency', Activity, 'Avg. latency'],
    ['packetLoss', Radio, 'Packet loss'], ['availability', Gauge, 'Availability'], ['download', Network, 'Avg. download'], ['upload', Network, 'Avg. upload']
  ] as const
  const traffic = data.traffic.map(m => ({ ...m, time: date(m.timestamp), total: +(m.downloadMbps + m.uploadMbps).toFixed(1) }))
  const pie = [{ name: 'Online', value: data.devices.filter(d => d.status === 'online').length, color: '#36d399' }, { name: 'Warning', value: data.devices.filter(d => d.status === 'warning').length, color: '#f5b942' }, { name: 'Offline', value: data.devices.filter(d => d.status === 'offline').length, color: '#fb7185' }]
  return <>
    <section className="page-heading"><div><p className="eyebrow">{data.mode === 'simulation' ? 'Simulation mode · backend-generated data' : 'Live monitoring · ICMP probes + local interface traffic'}</p><h1>Network overview</h1><p>{data.mode === 'simulation' ? 'Real-time health, traffic, and performance signals across your estate.' : 'Latency, loss, and reachability come from real ping checks. Traffic reflects this computer’s network interface.'}</p></div><button className="primary" onClick={onScenario}><Play size={16} /> {data.mode === 'simulation' ? 'Run network simulation' : 'Run all checks'}</button></section>
    <section className="kpi-grid">{kpis.map(([key, Icon, label]) => { const item = data.kpis[key]; const change = ((item.value - item.previous) / Math.max(Math.abs(item.previous), 1)) * 100; const precision = key === 'download' || key === 'upload' ? 2 : 1; return <article className="kpi" key={key}><div className="kpi-top"><span className="icon-box"><Icon size={18} /></span><span className={change <= 0 && key !== 'offlineDevices' ? 'delta good' : 'delta'}>{change > 0 ? '+' : ''}{fmt(change)}%</span></div><p>{label}</p><h2>{fmt(item.value, precision)}<small>{item.unit}</small></h2><div className="spark"><MiniTrend values={item.trend} /></div></article> })}</section>
    <section className="dashboard-grid"><article className="panel traffic-panel"><div className="panel-title"><div><h2>Network traffic</h2><p>Throughput · {data.capacity ? `Max Capacity: ${data.capacity.download} Mbps Down / ${data.capacity.upload} Mbps Up` : 'last 24 checks'}</p></div><select><option>Last 1 hour</option><option>Last 6 hours</option><option>Last 24 hours</option><option>Last 7 days</option></select></div><ResponsiveContainer width="100%" height={270}><AreaChart data={traffic}><defs><linearGradient id="download" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#6d5dfc" stopOpacity={.45}/><stop offset="1" stopColor="#6d5dfc" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#27314b"/><XAxis dataKey="time" tick={{fill:'#8e99b5',fontSize:11}}/><YAxis tick={{fill:'#8e99b5',fontSize:11}} unit=" Mbps"/><Tooltip contentStyle={{background:'#151c30',border:'1px solid #303c59',borderRadius:10}}/><Area type="monotone" dataKey="downloadMbps" name="Download" stroke="#8277ff" fill="url(#download)" strokeWidth={2}/><Area type="monotone" dataKey="uploadMbps" name="Upload" stroke="#35d5b3" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="total" name="Total" stroke="#f5b942" fill="transparent" strokeDasharray="4 4"/></AreaChart></ResponsiveContainer></article>
      <article className="panel health"><div className="panel-title"><div><h2>Network health</h2><p>Weighted performance score</p></div><Badge status={data.health.status.toLowerCase()} /></div><div className="score"><div className="score-ring" style={{'--score': `${data.health.score * 3.6}deg`} as React.CSSProperties}><strong>{data.health.score}</strong><span>/ 100</span></div><div><h3>{data.health.status}</h3><p>{data.health.explanation}</p></div></div><p className="formula">Availability 30% · Latency 20% · Packet loss 20% · Bandwidth 20% · Errors 10%</p></article>
      <article className="panel latency"><div className="panel-title"><div><h2>Latency monitoring</h2><p>Milliseconds per check</p></div><span className="metric-pill">P95 {fmt([...data.traffic].sort((a,b) => a.latencyMs-b.latencyMs)[Math.floor(data.traffic.length*.95)].latencyMs)} ms</span></div><ResponsiveContainer width="100%" height={210}><LineChart data={traffic}><CartesianGrid vertical={false} stroke="#27314b"/><XAxis dataKey="time" tick={{fill:'#8e99b5',fontSize:11}}/><YAxis tick={{fill:'#8e99b5',fontSize:11}}/><Tooltip contentStyle={{background:'#151c30',border:'1px solid #303c59',borderRadius:10}}/><Line type="monotone" dataKey="latencyMs" name="Latency" stroke="#e984ff" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></article>
      <article className="panel distribution"><div className="panel-title"><div><h2>Device status</h2><p>Current reachability</p></div></div><div className="donut"><ResponsiveContainer width="100%" height={185}><PieChart><Pie data={pie} dataKey="value" innerRadius={52} outerRadius={72} paddingAngle={4}>{pie.map(p => <Cell key={p.name} fill={p.color}/>)}</Pie><Tooltip contentStyle={{background:'#151c30',border:'1px solid #303c59',borderRadius:10}}/></PieChart></ResponsiveContainer><div className="legend">{pie.map(p => <span key={p.name}><i style={{background:p.color}}/>{p.name} <b>{p.value}</b></span>)}</div></div></article>
    </section>
    <section className="bottom-grid"><article className="panel"><div className="panel-title"><div><h2>Top problematic devices</h2><p>Dynamic risk score from downtime, latency, loss and alerts</p></div><ChevronRight size={18}/></div>{data.problematic.slice(0, 4).map((item, i) => <div className="rank" key={item.device.id}><span className="rank-number">0{i+1}</span><span className="device-dot"><Server size={15}/></span><div><b>{item.device.name}</b><small>{item.device.address} · {item.device.location}</small></div><strong>{item.score}</strong><Badge status={item.level.toLowerCase()} /></div>)}</article><AlertsPreview alerts={data.alerts} /></section>
  </>
}

function AlertsPreview({ alerts, onUpdate }: { alerts: Alert[]; onUpdate?: (id: number, action: 'acknowledge' | 'resolve') => void }) { return <article className="panel"><div className="panel-title"><div><h2>Smart alerts</h2><p>{alerts.filter(a => a.status === 'active').length} active issues need attention</p></div><Bell size={18}/></div>{alerts.slice(0, 4).map(a => <div className="alert-row" key={a.id}><span className={`severity ${a.severity}`}/><div><b>{a.message}</b><small>{a.deviceName} · {date(a.createdAt)}</small></div><Badge status={a.severity}/>{onUpdate && a.status === 'active' && <button className="ghost" onClick={() => onUpdate(a.id, 'acknowledge')}>Ack</button>}</div>)}</article> }

function DevicesPage({ devices, refresh }: { devices: Device[]; refresh: () => void }) { const [showForm, setShowForm] = useState(false); const [name, setName] = useState(''); const [address, setAddress] = useState(''); const [error, setError] = useState(''); const [checking, setChecking] = useState<number | null>(null)
 const add = async (e: React.FormEvent) => { e.preventDefault(); if (!name || !address) return setError('Device name and IPv4 address or hostname are required.'); try { await api.addDevice({ name, address, type: 'Computer', location: 'New location', monitoringInterval: 30 }); setName(''); setAddress(''); setShowForm(false); refresh() } catch (err) { setError(err instanceof Error ? err.message : 'Unable to add device') } }
 const check = async (id: number) => { setChecking(id); await api.check(id); await refresh(); setChecking(null) }
 return <><section className="page-heading"><div><p className="eyebrow">Inventory & reachability</p><h1>Devices</h1><p>Monitor endpoints and run on-demand checks.</p></div><button className="primary" onClick={() => setShowForm(!showForm)}><Plus size={16}/> Add device</button></section>{showForm && <form className="panel add-form" onSubmit={add}><h2>Add monitored device</h2><label>Device name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Lab-PC-04"/></label><label>IPv4 address or hostname<input value={address} onChange={e=>setAddress(e.target.value)} placeholder="192.168.1.10 or host.example"/></label><label>Device type<select><option>Computer</option><option>Server</option><option>Router</option><option>Switch</option><option>Access Point</option><option>IoT Device</option></select></label>{error && <p className="form-error">{error}</p>}<button className="primary">Save device</button></form>}<article className="panel table-panel"><table><thead><tr><th>Device</th><th>Address</th><th>Type</th><th>Status</th><th>Latency</th><th>Loss</th><th>Bandwidth</th><th>Last checked</th><th/></tr></thead><tbody>{devices.map(d=><tr key={d.id}><td><b>{d.name}</b><small>{d.location}</small></td><td>{d.address}</td><td>{d.type}</td><td><Badge status={d.status}/></td><td>{fmt(d.latest.latencyMs)} ms</td><td>{fmt(d.latest.packetLossPercent)}%</td><td>{fmt(d.latest.downloadMbps)} Mbps</td><td>{date(d.lastChecked)}</td><td><button className="ghost" disabled={checking===d.id} onClick={()=>check(d.id)}>{checking===d.id ? 'Checking…' : 'Check'}</button></td></tr>)}</tbody></table></article></> }

function MonitoringPage({ data, refresh }: { data: Dashboard; refresh: () => void }) { const [deviceId, setDeviceId] = useState(data.devices[0]?.id || 1); const [records, setRecords] = useState<Metric[]>([]); const [checking, setChecking] = useState(false); const device = data.devices.find(item => item.id === deviceId) || data.devices[0]; useEffect(() => { if (device) api.metrics(device.id).then(setRecords).catch(() => setRecords([])) }, [device?.id, data.generatedAt]); if (!device) return <div className="loading">Add a device to begin monitoring.</div>; const chartData=records.slice(-30).map(metric=>({...metric,time:date(metric.timestamp)})); const check=async()=>{setChecking(true);await api.check(device.id);await refresh();setChecking(false)}; return <><section className="page-heading"><div><p className="eyebrow">{data.mode === 'live' ? 'Live probes · Windows ICMP' : 'Demo monitoring probes'}</p><h1>Monitoring</h1><p>Inspect a target’s latest measurement history and trigger an on-demand probe.</p></div><div className="filters"><select value={device.id} onChange={event=>setDeviceId(+event.target.value)}>{data.devices.map(item=><option value={item.id} key={item.id}>{item.name} · {item.address}</option>)}</select><button className="primary" disabled={checking} onClick={check}><Play size={16}/>{checking?'Checking…':'Check now'}</button></div></section><section className="monitor-hero"><article className="panel target-card"><div className="panel-title"><div><p className="eyebrow">Selected target</p><h2>{device.name}</h2><p>{device.address} · {device.type} · {device.location}</p></div><Badge status={device.status}/></div><div className="probe-values"><div><small>Latency</small><b>{fmt(device.latest.latencyMs)} <em>ms</em></b></div><div><small>Packet loss</small><b>{fmt(device.latest.packetLossPercent,2)}<em>%</em></b></div><div><small>Availability</small><b>{fmt(device.latest.availabilityPercent,1)}<em>%</em></b></div><div><small>Last check</small><b className="last-time">{date(device.lastChecked)}</b></div></div></article><article className="panel monitor-note"><Radio size={22}/><h2>{data.mode === 'live' ? 'What is measured' : 'Simulation enabled'}</h2><p>{data.mode === 'live' ? 'Four ICMP echo requests determine reachability, latency and packet loss. Local traffic is sampled from this PC’s active Windows adapter.' : 'Metrics are generated by the backend’s controlled scenario service.'}</p></article></section><section className="dashboard-grid monitoring-charts"><article className="panel"><div className="panel-title"><div><h2>Latency & packet loss</h2><p>Latest {chartData.length} probe measurements</p></div></div><ResponsiveContainer width="100%" height={265}><LineChart data={chartData}><CartesianGrid vertical={false} stroke="#27314b"/><XAxis dataKey="time" tick={{fill:'#8e99b5',fontSize:11}}/><YAxis yAxisId="latency" tick={{fill:'#8e99b5',fontSize:11}}/><YAxis yAxisId="loss" orientation="right" tick={{fill:'#8e99b5',fontSize:11}}/><Tooltip contentStyle={{background:'#151c30',border:'1px solid #303c59',borderRadius:10}}/><Line yAxisId="latency" type="monotone" dataKey="latencyMs" name="Latency (ms)" stroke="#e984ff" strokeWidth={2} dot={false}/><Line yAxisId="loss" type="monotone" dataKey="packetLossPercent" name="Packet loss (%)" stroke="#f5b942" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></article><article className="panel"><div className="panel-title"><div><h2>Local interface traffic</h2><p>Traffic on the computer running this server</p></div></div><ResponsiveContainer width="100%" height={265}><AreaChart data={chartData}><CartesianGrid vertical={false} stroke="#27314b"/><XAxis dataKey="time" tick={{fill:'#8e99b5',fontSize:11}}/><YAxis tick={{fill:'#8e99b5',fontSize:11}}/><Tooltip contentStyle={{background:'#151c30',border:'1px solid #303c59',borderRadius:10}}/><Area type="monotone" dataKey="downloadMbps" name="Download Mbps" stroke="#8277ff" fill="#8277ff44"/><Area type="monotone" dataKey="uploadMbps" name="Upload Mbps" stroke="#35d5b3" fill="#35d5b344"/></AreaChart></ResponsiveContainer></article></section></> }

function AnalyticsPage({ devices }: { devices: Device[] }) { const [deviceId,setDeviceId]=useState(devices[0]?.id ?? 1); const [metric,setMetric]=useState('latencyMs'); const [method,setMethod]=useState('zscore'); const [stats,setStats]=useState<Statistics | null>(null); useEffect(()=>{api.statistics(deviceId, metric, method).then(setStats).catch(()=>setStats(null))},[deviceId,metric,method]); if(!stats) return <div className="loading">Calculating statistical analysis…</div>; const entries=[['Mean',stats.mean],['Median',stats.median],['Minimum',stats.min],['Maximum',stats.max],['Std. deviation',stats.standardDeviation],['Variance',stats.variance],['P95',stats.percentiles.P95],['P99',stats.percentiles.P99]]; return <><section className="page-heading"><div><p className="eyebrow">Statistical analysis</p><h1>Analytics</h1><p>Describe performance distributions, trends and abnormal behavior.</p></div><div className="filters"><select value={deviceId} onChange={e=>setDeviceId(+e.target.value)}>{devices.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select><select value={metric} onChange={e=>setMetric(e.target.value)}><option value="latencyMs">Latency</option><option value="packetLossPercent">Packet loss</option><option value="downloadMbps">Download bandwidth</option><option value="availabilityPercent">Availability</option></select><select value={method} onChange={e=>setMethod(e.target.value)}><option value="zscore">Z-Score</option><option value="iqr">IQR</option></select></div></section><section className="stats-grid">{entries.map(([label,value])=><article className="stat" key={label as string}><p>{label}</p><h2>{fmt(value as number,2)}</h2></article>)}</section><section className="dashboard-grid"><article className="panel"><div className="panel-title"><div><h2>Trend</h2><p>{stats.trend.direction} · {fmt(stats.trend.percentChange)}% change from first to last observation</p></div></div><ResponsiveContainer width="100%" height={245}><AreaChart data={stats.trend.movingAverage.map((value,i)=>({i,value}))}><CartesianGrid vertical={false} stroke="#27314b"/><XAxis dataKey="i" tick={{fill:'#8e99b5'}}/><YAxis tick={{fill:'#8e99b5'}}/><Tooltip contentStyle={{background:'#151c30',border:'1px solid #303c59',borderRadius:10}}/><Area type="monotone" dataKey="value" stroke="#8277ff" fill="#8277ff44"/></AreaChart></ResponsiveContainer></article><article className="panel"><h2>Anomaly detection ({method === 'zscore' ? 'Z-score |z| > 3' : 'IQR fences'})</h2><p className="panel-copy">{stats.anomalies.length} anomalous records identified from {stats.count} monitoring observations.</p><div className="anomalies">{stats.anomalies.slice(0,5).map((a,i)=><div key={i}><span className="severity critical"/><b>{fmt(a.value,2)}</b><small>{date(a.timestamp)} · expected {a.expected} · z {fmt(a.zScore,2)}</small></div>)}{!stats.anomalies.length&&<p>No anomalies in this period.</p>}</div></article></section><article className="panel correlation"><h2>Correlation analysis</h2><p>Pearson r = <b>{fmt(stats.correlation,2)}</b>. This indicates {Math.abs(stats.correlation) > .7 ? 'a strong' : Math.abs(stats.correlation) > .4 ? 'a moderate' : 'a weak'} relationship between latency and packet loss; correlation does not establish causation.</p></article></> }

function AlertsPage({ alerts, refresh }: { alerts: Alert[]; refresh: () => void }) { const update=async(id:number, action:'acknowledge'|'resolve')=>{await api.updateAlert(id,action);refresh()}; return <><section className="page-heading"><div><p className="eyebrow">Rules-based & statistical events</p><h1>Alerts</h1><p>Thresholds and detected anomalies from recent monitoring.</p></div></section><AlertsPreview alerts={alerts} onUpdate={update}/></> }
function ReportsPage() { const [report,setReport]=useState<Record<string,unknown>|null>(null); const generate=async(period:'daily'|'weekly')=>setReport((await api.report(period)).report); return <><section className="page-heading"><div><p className="eyebrow">Shareable summaries</p><h1>Reports</h1><p>Generate dynamic monitoring summaries from stored measurements.</p></div><div className="filters"><button className="primary" onClick={()=>generate('daily')}>Generate daily</button><button className="secondary" onClick={()=>generate('weekly')}>Generate weekly</button></div></section>{report&&<article className="panel report"><h2>{String(report.title)}</h2><p>Generated {String(report.generatedAt)}</p><dl>{Object.entries(report).filter(([k])=>!['title','generatedAt'].includes(k)).map(([k,v])=><div key={k}><dt>{pretty(k)}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>)}</dl><button className="secondary" onClick={()=>window.print()}>Print report</button></article>}</> }

function SettingsPage({ data, refresh }: { data: Dashboard; refresh: () => void }) {
  const [activeTab, setActiveTab] = useState('monitoring');
  const [settings, setSettings] = useState<import('./api').AppSettings | null>(null);
  
  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
  }, []);

  const save = async (updates: Partial<import('./api').AppSettings>) => {
    if (!settings) return;
    try {
      const updated = await api.updateSettings({ ...settings, ...updates });
      setSettings(updated);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to save settings');
    }
  };

  if (!settings) return <div className="loading">Loading settings...</div>;
  
  const tabs = [
    { id: 'monitoring', label: 'Monitoring Configuration', icon: Radio },
    { id: 'profile', label: 'User Profile & API', icon: User },
    { id: 'advanced', label: 'Advanced System', icon: Settings },
  ];

  return <>
    <section className="page-heading">
      <div><p className="eyebrow">System Preferences</p><h1>Settings</h1><p>Manage application preferences, API keys, and monitoring targets.</p></div>
    </section>
    
    <div className="settings-layout" style={{ display: 'flex', gap: '2rem', marginTop: '1rem', alignItems: 'flex-start' }}>
      <aside className="panel" style={{ width: '260px', flexShrink: 0, padding: '1rem' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {tabs.map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={activeTab === tab.id ? 'primary' : 'ghost'}
              style={{ justifyContent: 'flex-start', padding: '0.75rem 1rem', width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.75rem', borderRadius: '8px' }}
            >
              <tab.icon size={18} /> {tab.label}
            </button>
          ))}
        </div>
      </aside>
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {activeTab === 'monitoring' && (
           <article className="panel">
             <div className="panel-title"><div><h2>Monitoring Configuration</h2><p>Set how often devices are probed and default targets.</p></div></div>
             <form onSubmit={(e) => { e.preventDefault(); const formData = new FormData(e.currentTarget); save({ checkIntervalSeconds: Number(formData.get('interval')), dashboardRefreshMode: String(formData.get('refresh')), latencyThresholdMs: Number(formData.get('latency')) }) }} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
               <label className="settings-label" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 <b>Default Check Interval (Seconds)</b>
                 <input type="number" name="interval" defaultValue={settings.checkIntervalSeconds} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'inherit' }} />
               </label>
               <label className="settings-label" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 <b>Global Auto-Refresh (Dashboard)</b>
                 <select name="refresh" defaultValue={settings.dashboardRefreshMode} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'inherit' }}>
                   <option>Every 10 seconds</option>
                   <option>Every 30 seconds</option>
                   <option>Every 1 minute</option>
                   <option>Never (Manual)</option>
                 </select>
               </label>
               <label className="settings-label" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 <b>Alert Threshold: High Latency (ms)</b>
                 <input type="number" name="latency" defaultValue={settings.latencyThresholdMs} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'inherit' }} />
               </label>
               <button className="primary" style={{ alignSelf: 'flex-start', marginTop: '1rem' }}>Save Configuration</button>
             </form>
           </article>
        )}
        {activeTab === 'profile' && (
           <article className="panel">
             <div className="panel-title"><div><h2>User Profile & API Keys</h2><p>Manage your account and developer API keys.</p></div></div>
             <form onSubmit={(e) => { e.preventDefault(); const formData = new FormData(e.currentTarget); save({ displayName: String(formData.get('name')), email: String(formData.get('email')) }) }} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
               <label className="settings-label" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 <b>Display Name</b>
                 <input type="text" name="name" defaultValue={settings.displayName} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'inherit' }} />
               </label>
               <label className="settings-label" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                 <b>Email Address</b>
                 <input type="email" name="email" defaultValue={settings.email} style={{ padding: '0.75rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: '6px', color: 'inherit' }} />
               </label>
               <button className="primary" style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }}>Save Profile</button>
             </form>
               
             <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                 <h3>Developer API Keys</h3>
                 <p className="panel-copy" style={{ marginBottom: '1rem', marginTop: '0.25rem' }}>Use these keys to authenticate with the API programmatically.</p>
                 <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                   <input type="password" value="sk_live_948a9b..." readOnly style={{ flexGrow: 1, padding: '0.75rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '6px', color: '#8e99b5' }} />
                   <button className="secondary">Copy</button>
                   <button className="ghost">Revoke</button>
                 </div>
                 <button className="secondary" style={{ marginTop: '1rem' }}>Generate New Key</button>
             </div>
           </article>
        )}
        {activeTab === 'advanced' && (
           <article className="panel">
             <div className="panel-title"><div><h2>Advanced System Settings</h2><p>System-wide overrides and maintenance tools.</p></div></div>
             <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', marginTop: '1rem' }}>
               <div>
                 <h3 style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>Current Operating Mode <Badge status={settings.operatingMode === 'live' ? 'online' : 'warning'} /></h3>
                 <p className="panel-copy" style={{ marginTop: '0.5rem' }}>Simulation mode generates fake metrics without sending real network traffic.</p>
                 <button className="secondary" style={{ marginTop: '1rem' }} onClick={() => save({ operatingMode: settings.operatingMode === 'live' ? 'simulation' : 'live' })}>{settings.operatingMode === 'live' ? 'Switch to Simulation Mode' : 'Switch to Live Monitoring'}</button>
               </div>
               <div style={{ paddingTop: '1.5rem', borderTop: '1px solid var(--border)' }}>
                 <h3 style={{ color: '#fb7185' }}>Danger Zone</h3>
                 <p className="panel-copy" style={{ marginTop: '0.5rem' }}>Actions here cannot be undone. Proceed with caution.</p>
                 <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                   <button className="secondary" style={{ borderColor: '#fb7185', color: '#fb7185' }}>Clear Monitoring History</button>
                   <button className="secondary" style={{ borderColor: '#fb7185', color: '#fb7185' }}>Factory Reset</button>
                 </div>
               </div>
             </div>
           </article>
        )}
      </div>
    </div>
  </>
}

function App() { const [data,setData]=useState<Dashboard|null>(null); const [page,setPage]=useState('Dashboard'); const [dark,setDark]=useState(true); const [error,setError]=useState(''); const load=async()=>{try{setData(await api.dashboard());setError('')}catch(e){setError(e instanceof Error ? e.message:'Could not reach the monitoring API')}}; useEffect(()=>{load();const timer=setInterval(load,10000);return()=>clearInterval(timer)},[]); const nav=['Dashboard','Devices','Analytics','Alerts','Reports','Settings']; const content=useMemo(()=>{if(!data)return <div className="loading">Loading backend monitoring data…</div>; if(page==='Dashboard')return <DashboardPage data={data} onScenario={async()=>{await api.scenario();load()}}/>; if(page==='Devices')return <DevicesPage devices={data.devices} refresh={load}/>; if(page==='Analytics')return <AnalyticsPage devices={data.devices}/>; if(page==='Alerts')return <AlertsPage alerts={data.alerts} refresh={load}/>; if(page==='Reports')return <ReportsPage/>; return <SettingsPage data={data} refresh={load} />},[data,page]); return <div className={dark?'app dark':'app'}><aside><div className="brand"><span><Network size={21}/></span><div>Smart Network<small>MONITORING CONSOLE</small></div></div><nav>{nav.map(item=><button className={page===item?'active':''} onClick={()=>setPage(item)} key={item}>{item==='Dashboard'?<Gauge/>:item==='Devices'?<Server/>:item==='Analytics'?<Activity/>:item==='Alerts'?<Bell/>:<Radio/>}{item}</button>)}</nav><div className="side-bottom"><div className="mode"><i/> {data?.mode === 'live' ? 'LIVE MONITORING' : 'SIMULATION MODE'}</div><div className="operator"><span>AJ</span><div><b>Admin User</b><small>Administrator</small></div></div></div></aside><main><header><div className="search"><Search size={17}/><input placeholder="Search devices, alerts or IP address"/></div><div className="header-actions"><span className="live"><i/> System operational</span><button className="icon-button" onClick={()=>setDark(!dark)}>{dark?<Sun size={18}/>:<Moon size={18}/>}</button><button className="icon-button"><Bell size={18}/>{data&&data.alerts.filter(a=>a.status==='active').length>0&&<em/>}</button></div></header>{error?<div className="error"><CircleAlert size={17}/>{error}<button onClick={load}>Retry</button></div>:<div className="content">{content}</div>}</main></div> }
createRoot(document.getElementById('root')!).render(<App />)
