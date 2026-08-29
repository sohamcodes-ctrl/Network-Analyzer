# Network Monitoring Dashboard

A full-stack academic network-monitoring project that makes network performance and statistical analysis visible in one responsive operations console. **Live Mode** uses real Windows ICMP checks for latency, packet loss, and reachability, and reads this computer's adapter traffic rate. **Simulation Mode** remains available for presentations without a lab network.

## What is included

- React + TypeScript dashboard with responsive dark UI, traffic/latency charts, device inventory, live alert actions, and reports.
- Express + TypeScript REST API with live Windows ping checks, local interface traffic measurement, optional simulation, a 30-second monitoring cycle, KPI aggregation, health score, alert evaluation, and on-demand checks.
- Statistics: mean, median, variance, standard deviation, coefficient of variation, P25/P50/P75/P90/P95/P99, moving average, trend, Pearson correlation, and Z-score/IQR anomalies.
- MySQL schema including indexed `network_metrics`, users, devices, alerts, alert rules, and monitoring logs; a seven-day seed script is included.
- Authentication endpoint using bcrypt and JWT. Demo account: `admin@network.local` / `admin123` (use only in development; replace with database-backed users before deployment).

## Architecture

```text
React client → REST API → Express monitoring service → live Windows ICMP probes
                         └──────────────────────────→ MySQL historical data
```

The browser accesses only the API. The server stores the current session in memory, so it runs without MySQL. The SQL schema is ready for persistent production storage.

## Run locally

1. Copy `.env.example` to `.env`, set a strong `JWT_SECRET`, and change `MONITORED_TARGETS` to IP addresses or hostnames you are authorized to monitor. For example: `192.168.1.1,192.168.1.10,google.com`.
2. Run `npm install` in the project root.
3. Run `npm run dev`.
4. Open `http://localhost:5173`.

The backend is available at `http://localhost:4000`. Live Mode is the default (`SIMULATION_MODE=false`); it monitors `127.0.0.1` if no targets are configured. Set `SIMULATION_MODE=true` for the built-in demo scenario. To create the database, run `mysql -u root -p < database/schema.sql` then `mysql -u root -p < database/seed.sql`.

## Key API endpoints

| Area | Endpoint |
|---|---|
| Dashboard | `GET /api/dashboard` |
| Devices | `GET, POST /api/devices`; `GET /api/devices/:id` |
| Monitoring | `GET /api/monitoring/:deviceId`; `POST /api/monitoring/check/:deviceId` |
| Analytics | `GET /api/analytics/:deviceId/statistics?metric=latencyMs&method=zscore` |
| Alerts | `GET /api/alerts`; `PUT /api/alerts/:id/acknowledge`; `PUT /api/alerts/:id/resolve` |
| Simulation | `POST /api/simulation/run` |
| Reports | `GET /api/reports/daily`; `GET /api/reports/weekly` |

## Health and anomaly formulas

`health = availability×0.30 + latency×0.20 + packet-loss×0.20 + bandwidth×0.20 + errors×0.10`.

Latency and packet-loss factor scores are normalized to 0–100 before weighting. Z-score flags `|x - μ| / σ > 3`; IQR flags values outside `Q1 - 1.5×IQR` and `Q3 + 1.5×IQR`. Correlation is Pearson's *r* and is explicitly presented as association, not causation.

## Demo scenario

In Simulation Mode, use **Run network simulation** repeatedly to move the designated access point through normal operation, elevated latency, packet-loss anomaly, offline state, and recovery. In Live Mode, the button becomes **Run all checks**.

## Live-monitoring extension

`LiveMonitoringService.check()` now performs Windows ICMP probes. Download/upload figures are the aggregate rate of the computer running the server—not its maximum internet-plan speed or per-device consumption. They will be near zero while the machine is idle and rise while you stream or download. Per-device traffic requires SNMP counters from managed switches/routers or an installed monitoring agent. Persist checks to `network_metrics` with parameterized mysql2 queries before production use.

## Windows hotspot client traffic

When Windows Mobile Hotspot is enabled, the **Hotspot client traffic** panel identifies clients on `HOTSPOT_SUBNET` (by default `192.168.137.0/24`) and calculates their own download and upload rates from captured packet bytes. It requires Npcap and Wireshark's `tshark.exe`. Set `TSHARK_PATH` if Wireshark is installed elsewhere. The collector does not synthesize client traffic or alter a device's ping-based status.

## Future scope

Database repository integration, protected frontend routes, role-enforcement middleware, CSV export, websocket delivery, configurable rules UI, and a topology graph adapter are natural next steps.
