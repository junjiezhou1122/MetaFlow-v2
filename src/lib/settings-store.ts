import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultProviderSettings, normalizeProviderSettings } from "./provider-settings";
import type { ProviderSettings } from "./provider-settings";

const defaultDataDir = join(process.cwd(), ".metaflow-data");
const settingsFilename = "settings.json";

export class FileSettingsStore {
  private readonly filePath: string;

  constructor(private readonly dataDir = defaultDataDir) {
    this.filePath = join(dataDir, settingsFilename);
  }

  async load(): Promise<ProviderSettings> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const content = await readFile(this.filePath, "utf8");
      return normalizeProviderSettings(JSON.parse(content) as Partial<ProviderSettings>);
    } catch {
      return defaultProviderSettings;
    }
  }

  async save(settings: Partial<ProviderSettings>): Promise<ProviderSettings> {
    const normalized = normalizeProviderSettings(settings);
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return normalized;
  }
}
