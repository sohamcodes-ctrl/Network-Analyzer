import fs from 'fs/promises';
import path from 'path';

export interface AppSettings {
  checkIntervalSeconds: number;
  dashboardRefreshMode: string;
  latencyThresholdMs: number;
  displayName: string;
  email: string;
  operatingMode: 'live' | 'simulation';
}

const defaultSettings: AppSettings = {
  checkIntervalSeconds: 30,
  dashboardRefreshMode: 'Every 10 seconds',
  latencyThresholdMs: 100,
  displayName: 'Admin User',
  email: 'admin@example.com',
  operatingMode: 'live'
};

export class SettingsService {
  private configPath = path.join(process.cwd(), 'config.json');
  private settings: AppSettings = { ...defaultSettings };

  async loadSettings() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      this.settings = { ...defaultSettings, ...JSON.parse(data) };
    } catch (e) {
      // File doesn't exist or is invalid, use defaults
      await this.saveSettings(this.settings);
    }
  }

  async saveSettings(newSettings: Partial<AppSettings>) {
    this.settings = { ...this.settings, ...newSettings };
    await fs.writeFile(this.configPath, JSON.stringify(this.settings, null, 2));
  }

  getSettings() {
    return this.settings;
  }
}

export const settingsService = new SettingsService();
