CREATE DATABASE IF NOT EXISTS smart_network_monitoring;
USE smart_network_monitoring;

-- Users table
CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin', 'viewer') NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Devices table
CREATE TABLE devices (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45) NULL,
  hostname VARCHAR(253) NULL,
  type ENUM('Router', 'Switch', 'Server', 'Computer', 'Access Point', 'IoT Device') NOT NULL,
  location VARCHAR(150) NULL,
  monitoring_interval INT NOT NULL DEFAULT 30,
  status ENUM('online', 'offline', 'warning') NOT NULL DEFAULT 'offline',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_address (ip_address),
  UNIQUE KEY unique_hostname (hostname)
);

-- Network metrics table
CREATE TABLE network_metrics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  device_id BIGINT NOT NULL,
  timestamp DATETIME NOT NULL,
  latency_ms DECIMAL(10, 2) NULL,
  packet_loss_percent DECIMAL(6, 3) NULL,
  download_mbps DECIMAL(10, 2) NULL,
  upload_mbps DECIMAL(10, 2) NULL,
  availability_percent DECIMAL(6, 3) NULL,
  error_count INT NOT NULL DEFAULT 0,
  response_time_ms DECIMAL(10, 2) NULL,
  CONSTRAINT fk_metrics_device FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_metrics_device_timestamp (device_id, timestamp),
  INDEX idx_metrics_timestamp(timestamp)
);

-- Alert rules table
CREATE TABLE alert_rules (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  metric VARCHAR(50) NOT NULL,
  operator ENUM('gt', 'lt', 'gte', 'lte') NOT NULL,
  threshold DECIMAL(12, 3) NOT NULL,
  severity ENUM('info', 'warning', 'critical') NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

-- Alerts table
CREATE TABLE alerts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  device_id BIGINT NOT NULL,
  metric VARCHAR(50) NOT NULL,
  value DECIMAL(12, 3) NOT NULL,
  threshold DECIMAL(12, 3) NULL,
  severity ENUM('info', 'warning', 'critical') NOT NULL,
  message VARCHAR(500) NOT NULL,
  status ENUM('active', 'acknowledged', 'resolved') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  CONSTRAINT fk_alert_device FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_alert_status_created(status, created_at)
);

-- Monitoring logs table
CREATE TABLE monitoring_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  device_id BIGINT NOT NULL,
  timestamp DATETIME NOT NULL,
  check_type VARCHAR(40) NOT NULL,
  result ENUM('success', 'failure') NOT NULL,
  response_time DECIMAL(10, 2) NULL,
  error_message VARCHAR(500) NULL,
  CONSTRAINT fk_log_device FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE,
  INDEX idx_logs_device_timestamp(device_id, timestamp)
);

-- Insert default alert rules
INSERT INTO alert_rules(metric, operator, threshold, severity)
VALUES
  ('latency_ms', 'gt', 100, 'warning'),
  ('packet_loss_percent', 'gt', 3, 'critical'),
  ('availability_percent', 'lt', 95, 'warning'),
  ('download_mbps', 'lt', 10, 'warning'),
  ('z_score', 'gt', 3, 'warning');
