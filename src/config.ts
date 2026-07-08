import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_BASE_URL, RUNAPI_API_KEY_ENV } from "./constants.js";

export type RunApiConfig = {
  apiKey?: string;
  baseUrl: string;
};

export type CredentialSource = "env" | "config";

export type ConfigFile = {
  apiKey?: string;
  api_key?: string;
  baseUrl?: string;
  base_url?: string;
};

export type RunApiConfigDetails = RunApiConfig & {
  apiKeySource?: CredentialSource;
  configFile: string;
};

export function configPath(): string {
  return path.join(os.homedir(), ".config", "runapi", "config.json");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, filePath = configPath()): RunApiConfig {
  const { apiKey, baseUrl } = loadConfigDetails(env, filePath);
  return { apiKey, baseUrl };
}

export function loadConfigDetails(env: NodeJS.ProcessEnv = process.env, filePath = configPath()): RunApiConfigDetails {
  const file = readConfigFile(filePath);
  const envApiKey = env[RUNAPI_API_KEY_ENV]?.trim();
  const fileApiKey = file.api_key || file.apiKey || undefined;
  const apiKey = envApiKey || fileApiKey;
  const apiKeySource = envApiKey ? "env" : fileApiKey ? "config" : undefined;
  const baseUrl = env.RUNAPI_BASE_URL?.trim() || file.baseUrl || file.base_url || DEFAULT_BASE_URL;

  return { apiKey, apiKeySource, baseUrl, configFile: filePath };
}

export function requireApiKey(config = loadConfig()): string {
  if (!config.apiKey) {
    throw new Error("RunAPI API key is required. In an MCP host, call the login tool for browser login at https://runapi.ai. In a terminal, run `runapi login`. Headless hosts can set RUNAPI_API_KEY or pre-provision ~/.config/runapi/config.json.");
  }
  return config.apiKey;
}

export function readConfigFile(filePath = configPath()): ConfigFile {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as ConfigFile : {};
  } catch {
    return {};
  }
}
