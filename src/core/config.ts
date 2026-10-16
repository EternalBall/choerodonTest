import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { EnvConfigSchema, SuiteSchema, type EnvConfig, type Suite } from './schema.js';
import { PATHS } from './paths.js';

export async function readYamlFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw) as T;
}

export async function writeYamlFile(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, YAML.stringify(data), 'utf8');
}

export async function loadEnvConfig(filePath = PATHS.envFile): Promise<EnvConfig> {
  const data = await readYamlFile<unknown>(filePath);
  return EnvConfigSchema.parse(interpolateEnv(data));
}

export async function loadSuite(filePath: string): Promise<Suite> {
  const data = await readYamlFile<unknown>(filePath);
  return SuiteSchema.parse(interpolateEnv(data));
}

/** 简单替换 ${ENV.XXX} / ${env:XXX} */
export function interpolateEnv<T>(input: T): T {
  const replacer = (value: string): string =>
    value.replace(/\$\{(?:ENV\.|env:)?([A-Z0-9_]+)\}/g, (_, key: string) => {
      return process.env[key] ?? '';
    });

  if (typeof input === 'string') return replacer(input) as T;
  if (Array.isArray(input)) return input.map((v) => interpolateEnv(v)) as T;
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = interpolateEnv(v);
    }
    return out as T;
  }
  return input;
}

export async function loadElementLibrary(
  dir = PATHS.elements,
): Promise<Record<string, Record<string, unknown>>> {
  const lib: Record<string, Record<string, unknown>> = {};
  for (const file of await listYamlFilesRecursive(dir)) {
    const data = await readYamlFile<Record<string, Record<string, unknown>>>(file);
    Object.assign(lib, data);
  }
  return lib;
}

/** 收集目录下全部 yaml（含 elements/<slug>/generated.yaml） */
async function listYamlFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await listYamlFilesRecursive(full)));
    } else if (ent.isFile() && /\.ya?ml$/i.test(ent.name)) {
      out.push(full);
    }
  }
  return out;
}
