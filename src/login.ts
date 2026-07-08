import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DEFAULT_BASE_URL, RUNAPI_API_KEY_ENV, USER_AGENT } from "./constants.js";
import { configPath, loadConfigDetails, readConfigFile } from "./config.js";
import { errorFromResponse, friendlyError, RunApiClientError } from "./errors.js";
import { RunApiClient } from "./runapi-client.js";
import { jsonText } from "./tool-response.js";

export type LoginInput = {
  force?: boolean;
};

export type LoginResult = {
  authenticated: boolean;
  source?: "env" | "config";
  base_url: string;
  config_path: string;
  wrote_config: boolean;
  verified?: boolean;
  browser_opened?: boolean;
  open_browser_error?: string;
  authorize_url?: string;
  callback_url?: string;
  callback_port?: number;
  display_code?: string;
  expires_in_seconds?: number;
  user?: { email?: string };
  token_name?: string;
  error?: string;
  hint?: string;
};

export type CallbackPayload = {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
};

export type CallbackListener = {
  port: number;
  wait: () => Promise<CallbackPayload>;
  close: () => Promise<void> | void;
};

export type LoginPendingPayload = Pick<
  LoginResult,
  "authorize_url" | "callback_url" | "callback_port" | "display_code" | "expires_in_seconds" | "browser_opened" | "open_browser_error"
>;

export type LoginDependencies = {
  env?: NodeJS.ProcessEnv;
  configFile?: string;
  fetchImpl?: typeof fetch;
  hostname?: string;
  userAgent?: string;
  timeoutMs?: number;
  openBrowserTimeoutMs?: number;
  randomBytes?: (size: number) => Buffer;
  signal?: AbortSignal;
  openBrowser?: (url: string) => Promise<void>;
  createCallbackListener?: (options: { state: string; timeoutMs: number }) => Promise<CallbackListener>;
  onPending?: (payload: LoginPendingPayload) => Promise<void> | void;
};

export type PkcePair = {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
};

type ExchangeResponse = {
  key?: string;
  name?: string;
  user?: { email?: string };
};

const LOGIN_TIMEOUT_MS = 300_000;
const OPEN_BROWSER_TIMEOUT_MS = 10_000;
const DISPLAY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

class LoginCancelledError extends Error {
  constructor() {
    super("RunAPI login was cancelled.");
    this.name = "LoginCancelledError";
  }
}

export function generatePkcePair(bytes: Uint8Array = crypto.randomBytes(32)): PkcePair {
  const codeVerifier = base64Url(bytes);
  return {
    codeVerifier,
    codeChallenge: base64Url(crypto.createHash("sha256").update(codeVerifier).digest()),
    codeChallengeMethod: "S256"
  };
}

export function generateDisplayCode(bytes: Uint8Array = crypto.randomBytes(5)): string {
  let buffer = 0;
  let bits = 0;
  let output = "";

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5 && output.length < 8) {
      bits -= 5;
      output += DISPLAY_CODE_ALPHABET[(buffer >> bits) & 31];
    }
  }

  while (output.length < 8) {
    output += DISPLAY_CODE_ALPHABET[0];
  }

  return `${output.slice(0, 4)}-${output.slice(4, 8)}`;
}

export async function login(input: LoginInput = {}, deps: LoginDependencies = {}): Promise<LoginResult> {
  const env = deps.env ?? process.env;
  const configFile = deps.configFile ?? configPath();
  const config = loadConfigDetails(env, configFile);
  const baseResult = {
    base_url: config.baseUrl,
    config_path: configFile,
    wrote_config: false
  };

  if (config.apiKeySource === "env") {
    if (input.force) {
      return {
        ...baseResult,
        authenticated: true,
        source: "env",
        hint: `${RUNAPI_API_KEY_ENV} is set and takes precedence over local config. Unset or update it before forcing browser login.`
      };
    }

    return {
      ...baseResult,
      authenticated: true,
      source: "env",
      hint: `Using ${RUNAPI_API_KEY_ENV}. If authenticated tools fail, update or unset the environment variable.`
    };
  }

  if (config.apiKeySource === "config" && !input.force) {
    return {
      ...baseResult,
      authenticated: true,
      source: "config"
    };
  }

  const randomBytes = deps.randomBytes ?? ((size: number) => crypto.randomBytes(size));
  const state = base64Url(randomBytes(32));
  const pkce = generatePkcePair(randomBytes(32));
  const displayCode = generateDisplayCode(randomBytes(5));
  const timeoutMs = deps.timeoutMs ?? LOGIN_TIMEOUT_MS;
  const hostname = deps.hostname ?? (os.hostname() || "device");
  const fetchImpl = deps.fetchImpl ?? fetch;
  const userAgent = deps.userAgent ?? USER_AGENT;
  const signal = deps.signal;
  const openBrowserTimeoutMs = deps.openBrowserTimeoutMs ?? OPEN_BROWSER_TIMEOUT_MS;
  let listener: CallbackListener | undefined;
  let callbackUrl: string | undefined;
  let authorizeUrl: string | undefined;
  let browserOpened: boolean | undefined;
  let openBrowserError: string | undefined;

  try {
    throwIfAborted(signal);
    listener = await (deps.createCallbackListener ?? createLoopbackCallbackListener)({ state, timeoutMs });
    callbackUrl = `http://127.0.0.1:${listener.port}/callback`;
    authorizeUrl = buildAuthorizeUrl(config.baseUrl, {
      state,
      codeChallenge: pkce.codeChallenge,
      redirectPort: listener.port,
      displayCode,
      hostname
    });
    browserOpened = true;

    try {
      await withCancellation(
        withTimeout((deps.openBrowser ?? openSystemBrowser)(authorizeUrl), openBrowserTimeoutMs, "Opening the browser timed out."),
        signal
      );
    } catch (error) {
      if (error instanceof LoginCancelledError) {
        throw error;
      }
      browserOpened = false;
      openBrowserError = friendlyError(error);
      await notifyPending(deps.onPending, pendingPayload({
        authorizeUrl,
        callbackUrl,
        callbackPort: listener.port,
        displayCode,
        timeoutMs,
        browserOpened,
        openBrowserError
      }));
    }

    const callback = await withCancellation(listener.wait(), signal);
    if (callback.state !== state) {
      return {
        ...baseResult,
        authenticated: false,
        browser_opened: browserOpened,
        open_browser_error: openBrowserError,
        authorize_url: authorizeUrl,
        callback_url: callbackUrl,
        callback_port: listener.port,
        display_code: displayCode,
        expires_in_seconds: Math.floor(timeoutMs / 1000),
        error: "Authorization callback state did not match.",
        hint: "Retry login and only approve the browser window opened for this request."
      };
    }

    if (callback.error) {
      return {
        ...baseResult,
        authenticated: false,
        browser_opened: browserOpened,
        open_browser_error: openBrowserError,
        authorize_url: authorizeUrl,
        callback_url: callbackUrl,
        callback_port: listener.port,
        display_code: displayCode,
        expires_in_seconds: Math.floor(timeoutMs / 1000),
        error: callback.error_description || callback.error
      };
    }

    if (!callback.code) {
      return {
        ...baseResult,
        authenticated: false,
        browser_opened: browserOpened,
        open_browser_error: openBrowserError,
        authorize_url: authorizeUrl,
        callback_url: callbackUrl,
        callback_port: listener.port,
        display_code: displayCode,
        expires_in_seconds: Math.floor(timeoutMs / 1000),
        error: "Authorization callback did not include a code."
      };
    }

    throwIfAborted(signal);
    const exchanged = await exchangeCode({
      baseUrl: config.baseUrl,
      code: callback.code,
      codeVerifier: pkce.codeVerifier,
      redirectPort: listener.port,
      hostname,
      userAgent,
      fetchImpl
    });

    if (!exchanged.key) {
      return {
        ...baseResult,
        authenticated: false,
        browser_opened: browserOpened,
        open_browser_error: openBrowserError,
        authorize_url: authorizeUrl,
        callback_url: callbackUrl,
        callback_port: listener.port,
        display_code: displayCode,
        expires_in_seconds: Math.floor(timeoutMs / 1000),
        error: "RunAPI did not return an API key."
      };
    }

    throwIfAborted(signal);
    await writeConfigApiKey(configFile, exchanged.key);

    try {
      await new RunApiClient({ apiKey: exchanged.key, baseUrl: config.baseUrl }, fetchImpl, userAgent).balance();
    } catch (error) {
      return {
        ...baseResult,
        authenticated: false,
        source: "config",
        wrote_config: true,
        verified: false,
        browser_opened: browserOpened,
        open_browser_error: openBrowserError,
        authorize_url: authorizeUrl,
        callback_url: callbackUrl,
        callback_port: listener.port,
        display_code: displayCode,
        expires_in_seconds: Math.floor(timeoutMs / 1000),
        user: exchanged.user,
        token_name: exchanged.name,
        error: friendlyError(error),
        hint: "The token was saved, but verification failed. Retry an authenticated tool or run login again."
      };
    }

    return {
      ...baseResult,
      authenticated: true,
      source: "config",
      wrote_config: true,
      verified: true,
      browser_opened: browserOpened,
      open_browser_error: openBrowserError,
      authorize_url: authorizeUrl,
      callback_url: callbackUrl,
      callback_port: listener.port,
      display_code: displayCode,
      expires_in_seconds: Math.floor(timeoutMs / 1000),
      user: exchanged.user,
      token_name: exchanged.name
    };
  } catch (error) {
    return {
      ...baseResult,
      authenticated: false,
      browser_opened: browserOpened,
      open_browser_error: openBrowserError,
      authorize_url: authorizeUrl,
      callback_url: callbackUrl,
      callback_port: listener?.port,
      display_code: displayCode,
      expires_in_seconds: Math.floor(timeoutMs / 1000),
      error: friendlyLoginError(error)
    };
  } finally {
    await listener?.close();
  }
}

export function registerLoginTool(server: McpServer, deps: LoginDependencies = {}): void {
  server.tool(
    "login",
    "Authenticate RunAPI by opening a browser PKCE login flow and saving the API key to ~/.config/runapi/config.json.",
    {
      force: z.boolean().default(false).describe("Re-run browser login when the current credential comes from the local config file.")
    },
    async ({ force }, extra) => jsonText(await login({ force }, {
      ...deps,
      signal: extra.signal,
      onPending: async (payload) => {
        await notifyPending(deps.onPending, payload);
        await Promise.allSettled([
          extra.sendNotification({
            method: "notifications/message",
            params: {
              level: "notice",
              logger: "runapi.login",
              data: {
                message: "Open this RunAPI login URL in your browser to continue authentication.",
                ...payload
              }
            }
          }),
          extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken: extra._meta?.progressToken ?? "runapi-login",
              progress: 0,
              total: payload.expires_in_seconds ?? Math.floor(LOGIN_TIMEOUT_MS / 1000),
              message: `RunAPI login URL: ${payload.authorize_url}`
            }
          })
        ]);
      }
    }))
  );
}

export async function openSystemBrowser(url: string, platform: NodeJS.Platform = process.platform, timeoutMs = OPEN_BROWSER_TIMEOUT_MS): Promise<void> {
  const command = browserCommand(url, platform);
  if (!command) {
    throw new Error(`Opening a browser is not supported on ${platform}.`);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const child = spawn(command.command, command.args, { stdio: "ignore", shell: false });
    const timeout = setTimeout(() => {
      finish(new Error("Opening the browser timed out."));
      child.kill();
    }, timeoutMs);

    function finish(error?: Error) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }

    child.once("error", finish);
    child.once("close", (code) => {
      if (code === 0) {
        finish();
      } else {
        finish(new Error(`${command.command} exited with status ${code ?? "unknown"}.`));
      }
    });
  });
}

export function browserCommand(url: string, platform: NodeJS.Platform): { command: string; args: string[] } | undefined {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "linux":
      return { command: "xdg-open", args: [url] };
    case "win32":
      return { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] };
    default:
      return undefined;
  }
}

async function exchangeCode(options: {
  baseUrl: string;
  code: string;
  codeVerifier: string;
  redirectPort: number;
  hostname: string;
  userAgent: string;
  fetchImpl: typeof fetch;
}): Promise<ExchangeResponse> {
  const response = await options.fetchImpl(new URL("/api/v1/cli/exchange", trimBaseUrl(options.baseUrl)), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": options.userAgent,
      "x-cli-hostname": options.hostname
    },
    body: JSON.stringify({
      code: options.code,
      code_verifier: options.codeVerifier,
      redirect_port: options.redirectPort
    })
  });

  if (!response.ok) {
    throw await errorFromResponse(response);
  }

  return await response.json() as ExchangeResponse;
}

function buildAuthorizeUrl(baseUrl: string, params: {
  state: string;
  codeChallenge: string;
  redirectPort: number;
  displayCode: string;
  hostname: string;
}): string {
  const url = new URL("/cli/authorize", trimBaseUrl(baseUrl));
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_port", String(params.redirectPort));
  url.searchParams.set("display_code", params.displayCode);
  url.searchParams.set("hostname", params.hostname);
  return url.toString();
}

async function writeConfigApiKey(filePath: string, apiKey: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  await chmodIfSupported(dir, 0o700);

  const existing = readConfigObject(filePath);
  const next: Record<string, unknown> = {
    ...existing,
    api_key: apiKey
  };
  delete next.apiKey;
  const tmp = path.join(dir, `.config.json.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`);

  try {
    await fs.promises.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await chmodIfSupported(tmp, 0o600);
    await fs.promises.rename(tmp, filePath);
    await chmodIfSupported(filePath, 0o600);
  } catch (error) {
    await removeTempFile(tmp);
    throw error;
  }
}

function readConfigObject(filePath: string): Record<string, unknown> {
  const parsed = readConfigFile(filePath) as Record<string, unknown>;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function pendingPayload(options: {
  authorizeUrl: string;
  callbackUrl: string;
  callbackPort: number;
  displayCode: string;
  timeoutMs: number;
  browserOpened: boolean;
  openBrowserError?: string;
}): LoginPendingPayload {
  return {
    authorize_url: options.authorizeUrl,
    callback_url: options.callbackUrl,
    callback_port: options.callbackPort,
    display_code: options.displayCode,
    expires_in_seconds: Math.floor(options.timeoutMs / 1000),
    browser_opened: options.browserOpened,
    open_browser_error: options.openBrowserError
  };
}

async function notifyPending(onPending: LoginDependencies["onPending"], payload: LoginPendingPayload): Promise<void> {
  try {
    await onPending?.(payload);
  } catch {
    // Best effort only; authentication should continue even if the host cannot
    // surface the manual login URL notification.
  }
}

function friendlyLoginError(error: unknown): string {
  if (error instanceof RunApiClientError) {
    return friendlyError(error);
  }
  if (error instanceof LoginCancelledError) {
    return error.message;
  }
  if (error instanceof Error && error.message === "Timed out waiting for browser authorization.") {
    return error.message;
  }

  return "RunAPI login could not complete.";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new LoginCancelledError();
  }
}

async function withCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }
  throwIfAborted(signal);

  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new LoginCancelledError());
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function removeTempFile(filePath: string): Promise<void> {
  try {
    await fs.promises.rm(filePath, { force: true });
  } catch {
    // Best effort cleanup; preserve the original config write error.
  }
}

async function chmodIfSupported(filePath: string, mode: number): Promise<void> {
  if (process.platform === "win32") {
    return;
  }

  try {
    await fs.promises.chmod(filePath, mode);
  } catch {
    // Best effort only; the login flow should not fail on filesystems that
    // cannot apply POSIX modes.
  }
}

async function createLoopbackCallbackListener(options: { state: string; timeoutMs: number }): Promise<CallbackListener> {
  let settled = false;
  let resolvePayload: (payload: CallbackPayload) => void;
  let rejectPayload: (error: Error) => void;
  let timeout: NodeJS.Timeout | undefined;

  const waitPromise = new Promise<CallbackPayload>((resolve, reject) => {
    resolvePayload = resolve;
    rejectPayload = reject;
  });

  const server = http.createServer((request, response) => {
    const payload = parseCallback(request, serverAddressPort(server));
    if (!payload) {
      writeCallbackHtml(response, 404, "Not found.");
      return;
    }

    if (payload.state !== options.state) {
      writeCallbackHtml(response, 400, "Authorization failed. You can close this tab.");
      return;
    }

    if (payload.error) {
      writeCallbackHtml(response, 400, "Authorization canceled. You can close this tab.");
      settle(payload);
      return;
    }

    writeCallbackHtml(response, 200, "Authorization received. You can close this tab and return to your MCP client.");
    settle(payload);
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(serverAddressPort(server)));
  });

  timeout = setTimeout(() => {
    settleError(new Error("Timed out waiting for browser authorization."));
  }, options.timeoutMs);

  function settle(payload: CallbackPayload) {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timeout);
    resolvePayload(payload);
  }

  function settleError(error: Error) {
    if (settled) {
      return;
    }

    settled = true;
    clearTimeout(timeout);
    rejectPayload(error);
  }

  return {
    port,
    wait: () => waitPromise,
    close: async () => {
      clearTimeout(timeout);
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}

function parseCallback(request: IncomingMessage, port: number): CallbackPayload | undefined {
  if (!request.url) {
    return undefined;
  }

  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  if (url.pathname !== "/callback") {
    return undefined;
  }

  return {
    code: url.searchParams.get("code") || undefined,
    state: url.searchParams.get("state") || undefined,
    error: url.searchParams.get("error") || undefined,
    error_description: url.searchParams.get("error_description") || undefined
  };
}

function writeCallbackHtml(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*"
  });
  response.end(`<!doctype html><html><head><meta charset="utf-8"><title>RunAPI authorization</title></head><body><p>${escapeHtml(message)}</p></body></html>`);
}

function serverAddressPort(server: http.Server): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine callback listener port.");
  }
  return address.port;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function trimBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") || DEFAULT_BASE_URL;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
