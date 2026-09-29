# Network Monitoring Dashboard

A full-stack academic network-monitoring project that makes network performance and statistical analysis visible in one responsive operations console. **Live Mode** uses real Windows ICMP checks for latency, packet loss, and reachability, and reads this computer's adapter traffic rate. **Simulation Mode** remains available for presentations without a lab network.

## What is included

- React + TypeScript dashboard with responsive dark UI, traffic/latency charts, device inventory, live alert actions, and reports.
- Express + TypeScript REST API with live Windows ping checks, local interface traffic measurement, optional simulation, a 30-second monitoring cycle, KPI aggregation, health score, alert evaluation, and on-demand checks.
- Statistics: mean, median, variance, standard deviation, coefficient of variation, P25/P50/P75/P90/P95/P99, moving average, trend, Pearson correlation, and Z-score/IQR anomalies.
- MySQL schema including indexed `network_metrics`, users, devices, alerts, alert rules, and monitoring logs; a seven-day seed script is included.
- Authentication uses bcrypt-backed bootstrap credentials and JWT bearer tokens. Development defaults to `admin@network.local` / `admin123`; set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and a strong `JWT_SECRET` before use outside local development. Optional viewer credentials can be configured with `VIEWER_EMAIL` and `VIEWER_PASSWORD`.

## Architecture

```text
React client → REST API → Express monitoring service → live Windows ICMP probes
                         └──────────────────────────→ MySQL historical data
```

The browser accesses only the API. Login is required for all API routes except `/api/auth/login`; administrator credentials are required for device creation, alert changes, simulation runs, and settings changes. The current session token is held in browser session storage and expires after eight hours. Monitoring state is still in memory; MySQL persistence is planned for the next phase.

## Run locally

1. Copy `.env.example` to `.env`, set a strong `JWT_SECRET` and non-default `ADMIN_PASSWORD`, and change `MONITORED_TARGETS` to IP addresses or hostnames you are authorized to monitor. For example: `192.168.1.1,192.168.1.10,google.com`.
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

All endpoints except `POST /api/auth/login` require `Authorization: Bearer <token>`. The login limiter allows five attempts per IP/email key within fifteen minutes. The current bootstrap users are environment-based; database-backed users will be introduced with persistence.

## Health and anomaly formulas

`health = availability×0.30 + latency×0.20 + packet-loss×0.20 + bandwidth×0.20 + errors×0.10`.

Latency and packet-loss factor scores are normalized to 0–100 before weighting. Z-score flags `|x - μ| / σ > 3`; IQR flags values outside `Q1 - 1.5×IQR` and `Q3 + 1.5×IQR`. Correlation is Pearson's *r* and is explicitly presented as association, not causation.

## Demo scenario

In Simulation Mode, use **Run network simulation** repeatedly to move the designated access point through normal operation, elevated latency, packet-loss anomaly, offline state, and recovery. In Live Mode, the button becomes **Run all checks**.

## Live-monitoring extension

`LiveMonitoringService.check()` now performs Windows ICMP probes. Download/upload figures are the aggregate rate of the computer running the server—not its maximum internet-plan speed or per-device consumption. They will be near zero while the machine is idle and rise while you stream or download. Per-device traffic requires SNMP counters from managed switches/routers or an installed monitoring agent. Persist checks to `network_metrics` with parameterized mysql2 queries before production use.

## Windows hotspot client traffic

When Windows Mobile Hotspot is enabled, the **Hotspot client traffic** panel identifies clients on `HOTSPOT_SUBNET` (by default `192.168.137.0/24`) and calculates their own download and upload rates from captured packet bytes. It requires Npcap and Wireshark's `tshark.exe`. Set `TSHARK_PATH` if Wireshark is installed elsewhere. The collector does not synthesize client traffic or alter a device's ping-based status.

## Security notes

- Never use the development password or JWT fallback in production. Production startup fails when `JWT_SECRET` or `ADMIN_PASSWORD` is missing.
- Only monitor systems you own or are authorized to test. Target allowlisting and stronger SSRF protections will be added with the live monitoring repository work.
- Logs contain request method, path, status, and a generic error message; passwords, tokens, and request bodies are not logged.

## Future scope

Database repository integration, persistent history, CSV export, websocket delivery, configurable rules UI, and a topology graph adapter are natural next steps.
