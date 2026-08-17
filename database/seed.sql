USE smart_network_monitoring;
INSERT INTO devices(name,ip_address,type,location,monitoring_interval,status) VALUES
('Edge-Router-01','192.168.1.1','Router','Core Room',30,'online'),
('Core-Switch-01','192.168.1.2','Switch','Core Room',30,'online'),
('App-Server-01','192.168.1.10','Server','Server Rack A',30,'online'),
('Database-01','192.168.1.11','Server','Server Rack B',30,'online'),
('Lab-PC-01','192.168.1.31','Computer','Computer Lab',30,'online'),
('West-AP-01','192.168.1.41','Access Point','West Wing',30,'warning'),
('Security-Cam-01','192.168.1.61','IoT Device','Main Entrance',60,'online');

-- Generate historical values with an intentional periodic degraded condition for presentation.
INSERT INTO network_metrics(
  device_id,
  timestamp,
  latency_ms,
  packet_loss_percent,
  download_mbps,
  upload_mbps,
  availability_percent,
  error_count,
  response_time_ms
)
SELECT
  d.id,
  DATE_SUB(NOW(), INTERVAL h.n HOUR),
  30 + MOD(h.n * 7 + d.id * 3, 25) + IF(d.id = 6 AND MOD(h.n, 18) = 0, 100, 0),
  IF(d.id = 6 AND MOD(h.n, 18) = 0, 7.2, MOD(h.n + d.id, 10) / 20),
  70 + MOD(h.n * 11 + d.id, 35),
  22 + MOD(h.n * 3 + d.id, 14),
  IF(d.id = 6 AND MOD(h.n, 18) = 0, 96, 99.8),
  IF(d.id = 6 AND MOD(h.n, 18) = 0, 2, 0),
  35 + MOD(h.n * 7 + d.id * 3, 25)
FROM devices d
CROSS JOIN (
  SELECT ones.n + 10 * tens.n + 100 * hundreds.n n
  FROM (
    SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
    UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
  ) ones
  CROSS JOIN (
    SELECT 0 n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
    UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
  ) tens
  CROSS JOIN (
    SELECT 0 n UNION SELECT 1 UNION SELECT 2
  ) hundreds
) h
WHERE h.n < 168;
