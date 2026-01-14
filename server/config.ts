import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ServerConfig {
  port: number;
  host: string;
}

export interface StorageConfig {
  dataDir: string;
  booksDir: string;
  dbPath: string;
}

export interface AppConfig {
  server: ServerConfig;
  storage: StorageConfig;
}

interface RawConfig {
  server?: {
    port?: number;
    host?: string;
  };
  storage?: {
    dataDir?: string;
  };
}

function expandPath(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

function findConfigFile(cliConfigPath?: string): string | null {
  // CLI override takes priority
  if (cliConfigPath) {
    const expanded = expandPath(cliConfigPath);
    if (fs.existsSync(expanded)) {
      return expanded;
    }
    console.warn(`Config file not found: ${expanded}`);
    return null;
  }

  // Default locations
  const defaultPaths = [
    path.join(os.homedir(), '.config', 'rsvpub', 'config.json'),
    path.join(process.cwd(), 'config.json'),
  ];

  for (const p of defaultPaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return null;
}

function parseCliArgs(): { config?: string; port?: number; host?: string } {
  const args = process.argv.slice(2);
  const result: { config?: string; port?: number; host?: string } = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--config' && args[i + 1]) {
      result.config = args[++i];
    } else if (arg.startsWith('--config=')) {
      result.config = arg.split('=')[1];
    } else if (arg === '--port' && args[i + 1]) {
      result.port = parseInt(args[++i], 10);
    } else if (arg.startsWith('--port=')) {
      result.port = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--host' && args[i + 1]) {
      result.host = args[++i];
    } else if (arg.startsWith('--host=')) {
      result.host = arg.split('=')[1];
    }
  }

  return result;
}

export function loadConfig(): AppConfig {
  const cliArgs = parseCliArgs();
  const configPath = findConfigFile(cliArgs.config);

  // Default values
  const defaults: RawConfig = {
    server: {
      port: 7787,
      host: '127.0.0.1',
    },
    storage: {
      dataDir: '~/.local/share/rsvpub',
    },
  };

  let rawConfig: RawConfig = defaults;

  // Load from file if found
  if (configPath) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(content) as RawConfig;
      rawConfig = {
        server: { ...defaults.server, ...parsed.server },
        storage: { ...defaults.storage, ...parsed.storage },
      };
      console.log(`Loaded config from: ${configPath}`);
    } catch (err) {
      console.error(`Failed to parse config file: ${err}`);
    }
  } else {
    console.log('Using default configuration');
  }

  // CLI args override config file
  const port = cliArgs.port ?? rawConfig.server?.port ?? 7787;
  const host = cliArgs.host ?? rawConfig.server?.host ?? '127.0.0.1';
  const dataDir = expandPath(rawConfig.storage?.dataDir ?? '~/.local/share/rsvpub');

  return {
    server: { port, host },
    storage: {
      dataDir,
      booksDir: path.join(dataDir, 'books'),
      dbPath: path.join(dataDir, 'rsvpub.db'),
    },
  };
}

export function ensureStorageDirs(config: AppConfig): void {
  const dirs = [config.storage.dataDir, config.storage.booksDir];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    }
  }
}
