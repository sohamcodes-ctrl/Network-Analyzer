import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';

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
  operatingMode: process.env.SIMULATION_MODE === 'true' ? 'simulation' : 'live'
};

const settingsSchema = z.object({
  checkIntervalSeconds: z.number().int().min(5).max(3600),
  dashboardRefreshMode: z.string().min(1),
  latencyThresholdMs: z.number().int().min(1).max(5000),
  displayName: z.string().min(1).max(100),
  email: z.string().email(),
  operatingMode: z.enum(['live', 'simulation'])
});

export class SettingsService {
  private configPath = path.join(process.cwd(), 'config.json');
  private settings: AppSettings = { ...defaultSettings };

  async loadSettings() {
    try {
      const data = await fs.readFile(this.configPath, 'utf8');
      this.settings = settingsSchema.parse(JSON.parse(data));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        await this.saveSettings(defaultSettings);
        return;
      }
      throw new Error(`Unable to load settings from ${this.configPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async saveSettings(newSettings: Partial<AppSettings>) {
    const next = settingsSchema.parse({ ...this.settings, ...newSettings });
    const temporaryPath = `${this.configPath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(temporaryPath, this.configPath);
    this.settings = next;
  }

  getSettings() {
    return this.settings;
  }
}

export const settingsService = new SettingsService();
