import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfigDetails } from "../src/config.js";
import { browserCommand, generateDisplayCode, generatePkcePair, login } from "../src/login.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("login", () => {
  let tempHome: string | undefined;

  afterEach(() => {
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
    tempHome = undefined;
  });

  function tempConfigPath() {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "runapi-mcp-login-"));
    return path.join(tempHome, ".config", "runapi", "config.json");
  }

  it("generates PKCE S256 pairs and human-readable display codes", () => {
    const pair = generatePkcePair(Buffer.alloc(32, 1));

    expect(pair.codeVerifier).toBe("AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE");
    expect(pair.codeChallenge).toBe("VtX6czP210fbQsI5QH5dpMMvTHnzXQkrE0_TWkAtnFw");
    expect(pair.codeChallengeMethod).toBe("S256");
    expect(generateDisplayCode(Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]))).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it("returns authenticated without writing config when RUNAPI_API_KEY is present", async () => {
    const configFile = tempConfigPath();
    const openBrowser = vi.fn();

    const result = await login({}, {
      env: { RUNAPI_API_KEY: "env_key" },
      configFile,
      openBrowser
    });

    expect(result).toMatchObject({
      authenticated: true,
      source: "env",
      wrote_config: false
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("keeps the environment credential authenticated when force is requested", async () => {
    const configFile = tempConfigPath();
    const openBrowser = vi.fn();

    const result = await login({ force: true }, {
      env: { RUNAPI_API_KEY: "env_key" },
      configFile,
      openBrowser
    });

    expect(result).toMatchObject({
      authenticated: true,
      source: "env",
      wrote_config: false,
      hint: expect.stringContaining("RUNAPI_API_KEY")
    });
    expect(result.error).toBeUndefined();
    expect(openBrowser).not.toHaveBeenCalled();
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("returns authenticated without overwriting an existing config key", async () => {
    const configFile = tempConfigPath();
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ api_key: "config_key", base_url: "https://staging.runapi.ai" }));
    const openBrowser = vi.fn();

    const result = await login({}, {
      env: {},
      configFile,
      openBrowser
    });

    expect(result).toMatchObject({
      authenticated: true,
      source: "config",
      base_url: "https://staging.runapi.ai",
      wrote_config: false
    });
    expect(openBrowser).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toMatchObject({ api_key: "config_key" });
  });

  it("exchanges a browser code, merges api_key into config, and verifies the token", async () => {
    const configFile = tempConfigPath();
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ base_url: "https://staging.runapi.ai", keep_me: true }));
    const openBrowser = vi.fn(async () => {});
    const close = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({
        key: "new_token",
        name: "RunAPI token on test-host",
        token_type: "standard",
        user: { email: "user@example.test" }
      }, 201))
      .mockResolvedValueOnce(jsonResponse({ balance_cents: 123 }));

    const result = await login({ force: true }, {
      env: {},
      configFile,
      hostname: "test-host",
      randomBytes: (size) => Buffer.alloc(size, 2),
      openBrowser,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createCallbackListener: async ({ state }) => ({
        port: 4567,
        wait: async () => ({ code: "browser_code", state }),
        close
      })
    });

    expect(openBrowser).toHaveBeenCalledWith(expect.stringContaining("https://staging.runapi.ai/cli/authorize?"));
    const authorizeUrl = new URL(openBrowser.mock.calls[0][0]);
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizeUrl.searchParams.get("redirect_port")).toBe("4567");
    expect(authorizeUrl.searchParams.get("hostname")).toBe("test-host");
    expect(authorizeUrl.searchParams.get("display_code")).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, new URL("https://staging.runapi.ai/api/v1/cli/exchange"), expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        "content-type": "application/json",
        "x-cli-hostname": "test-host"
      }),
      body: expect.stringContaining("\"code\":\"browser_code\"")
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, new URL("https://staging.runapi.ai/api/v1/me/balance"), expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer new_token" })
    }));

    expect(result).toMatchObject({
      authenticated: true,
      source: "config",
      wrote_config: true,
      verified: true,
      user: { email: "user@example.test" }
    });
    expect(JSON.stringify(result)).not.toContain("new_token");
    expect(JSON.parse(fs.readFileSync(configFile, "utf8"))).toMatchObject({
      api_key: "new_token",
      base_url: "https://staging.runapi.ai",
      keep_me: true
    });
    expect(close).toHaveBeenCalled();
  });

  it("replaces a legacy apiKey credential with canonical api_key on force login", async () => {
    const configFile = tempConfigPath();
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, JSON.stringify({ apiKey: "legacy_token", base_url: "https://staging.runapi.ai", keep_me: true }));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ key: "new_token", user: { email: "user@example.test" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ balance_cents: 123 }));

    const result = await login({ force: true }, {
      env: {},
      configFile,
      openBrowser: vi.fn(async () => {}),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createCallbackListener: async ({ state }) => ({
        port: 4567,
        wait: async () => ({ code: "browser_code", state }),
        close: vi.fn()
      })
    });

    const written = JSON.parse(fs.readFileSync(configFile, "utf8"));
    expect(result).toMatchObject({ authenticated: true, wrote_config: true, verified: true });
    expect(written).toMatchObject({ api_key: "new_token", base_url: "https://staging.runapi.ai", keep_me: true });
    expect(written.apiKey).toBeUndefined();
    expect(loadConfigDetails({}, configFile)).toMatchObject({ apiKey: "new_token", apiKeySource: "config" });
  });

  it("notifies the manual URL before continuing when opening the browser fails", async () => {
    const configFile = tempConfigPath();
    const onPending = vi.fn();
    let finishCallback: (() => void) | undefined;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ key: "manual_token", user: { email: "manual@example.test" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ balance_cents: 1 }));

    const resultPromise = login({}, {
      env: {},
      configFile,
      openBrowser: vi.fn(async () => {
        throw new Error("xdg-open failed");
      }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createCallbackListener: async ({ state }) => ({
        port: 5678,
        wait: async () => new Promise((resolve) => {
          finishCallback = () => resolve({ code: "manual_code", state });
        }),
        close: vi.fn()
      }),
      onPending
    });

    await vi.waitFor(() => {
      expect(onPending).toHaveBeenCalledWith(expect.objectContaining({
        authorize_url: expect.stringContaining("https://runapi.ai/cli/authorize?"),
        browser_opened: false,
        callback_port: 5678,
        callback_url: "http://127.0.0.1:5678/callback",
        open_browser_error: expect.stringContaining("xdg-open failed")
      }));
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    finishCallback?.();
    const result = await resultPromise;

    expect(result).toMatchObject({
      authenticated: true,
      browser_opened: false,
      open_browser_error: expect.stringContaining("xdg-open failed"),
      callback_url: "http://127.0.0.1:5678/callback"
    });
  });

  it("returns an error payload when the callback listener cannot start", async () => {
    const configFile = tempConfigPath();
    const openBrowser = vi.fn();

    const result = await login({}, {
      env: {},
      configFile,
      openBrowser,
      createCallbackListener: async () => {
        throw new Error("cannot bind callback port");
      }
    });

    expect(result).toMatchObject({
      authenticated: false,
      wrote_config: false,
      error: "RunAPI login could not complete."
    });
    expect(JSON.stringify(result)).not.toContain("cannot bind callback port");
    expect(result.authorize_url).toBeUndefined();
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("times out browser opening and keeps waiting for a manual callback", async () => {
    const configFile = tempConfigPath();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ key: "manual_token", user: { email: "manual@example.test" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ balance_cents: 1 }));

    const result = await login({}, {
      env: {},
      configFile,
      openBrowserTimeoutMs: 1,
      openBrowser: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createCallbackListener: async ({ state }) => ({
        port: 5678,
        wait: async () => ({ code: "manual_code", state }),
        close: vi.fn()
      })
    });

    expect(result).toMatchObject({
      authenticated: true,
      browser_opened: false,
      open_browser_error: "Opening the browser timed out."
    });
  });

  it("closes the callback listener when the MCP request is cancelled", async () => {
    const configFile = tempConfigPath();
    const controller = new AbortController();
    const close = vi.fn();
    const fetchImpl = vi.fn();

    const resultPromise = login({}, {
      env: {},
      configFile,
      signal: controller.signal,
      openBrowser: vi.fn(async () => {}),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createCallbackListener: async () => ({
        port: 6789,
        wait: async () => new Promise(() => {}),
        close
      })
    });

    controller.abort();
    const result = await resultPromise;

    expect(result).toMatchObject({
      authenticated: false,
      error: "RunAPI login was cancelled."
    });
    expect(close).toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(configFile)).toBe(false);
  });

  it("receives the real loopback callback response and completes login", async () => {
    const configFile = tempConfigPath();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ key: "loopback_token", user: { email: "loopback@example.test" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ balance_cents: 1 }));
    let callbackResponse: Response | undefined;

    const result = await login({}, {
      env: {},
      configFile,
      openBrowser: async (url) => {
        const authorizeUrl = new URL(url);
        callbackResponse = await fetch(`http://127.0.0.1:${authorizeUrl.searchParams.get("redirect_port")}/callback?code=loopback_code&state=${authorizeUrl.searchParams.get("state")}`);
      },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(callbackResponse?.status).toBe(200);
    expect(callbackResponse?.headers.get("cache-control")).toBe("no-store");
    await expect(callbackResponse?.text()).resolves.toContain("Authorization received");
    expect(result).toMatchObject({
      authenticated: true,
      source: "config",
      wrote_config: true,
      verified: true,
      user: { email: "loopback@example.test" }
    });
  });

  it("returns an error payload for callback cancellation", async () => {
    const configFile = tempConfigPath();
    const fetchImpl = vi.fn();

    const result = await login({}, {
      env: {},
      configFile,
      openBrowser: vi.fn(async () => {}),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createCallbackListener: async ({ state }) => ({
        port: 6789,
        wait: async () => ({ state, error: "access_denied", error_description: "Authorization canceled." }),
        close: vi.fn()
      })
    });

    expect(result).toMatchObject({
      authenticated: false,
      error: "Authorization canceled."
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns an error payload for callback timeout", async () => {
    const configFile = tempConfigPath();
    const fetchImpl = vi.fn();

    const result = await login({}, {
      env: {},
      configFile,
      timeoutMs: 10,
      openBrowser: vi.fn(async () => {}),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      createCallbackListener: async () => ({
        port: 6789,
        wait: async () => {
          throw new Error("Timed out waiting for browser authorization.");
        },
        close: vi.fn()
      })
    });

    expect(result).toMatchObject({
      authenticated: false,
      error: expect.stringContaining("Timed out")
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("ignores mismatched loopback callbacks and continues waiting for the matching state", async () => {
    const configFile = tempConfigPath();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ key: "loopback_token", user: { email: "loopback@example.test" } }, 201))
      .mockResolvedValueOnce(jsonResponse({ balance_cents: 1 }));
    const callbackResponses: Response[] = [];

    const result = await login({}, {
      env: {},
      configFile,
      openBrowser: async (url) => {
        const authorizeUrl = new URL(url);
        const port = authorizeUrl.searchParams.get("redirect_port");
        callbackResponses.push(await fetch(`http://127.0.0.1:${port}/callback?code=wrong_code&state=wrong-state`));
        callbackResponses.push(await fetch(`http://127.0.0.1:${port}/callback?code=loopback_code&state=${authorizeUrl.searchParams.get("state")}`));
      },
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(callbackResponses.map((response) => response.status)).toEqual([400, 200]);
    expect(result).toMatchObject({
      authenticated: true,
      source: "config",
      wrote_config: true,
      verified: true
    });
  });
});

describe("browserCommand", () => {
  it("selects platform browser openers without shell-parsed URLs", () => {
    const url = "https://runapi.ai/cli/authorize?state=a&redirect_port=1234";

    expect(browserCommand(url, "darwin")).toEqual({ command: "open", args: [url] });
    expect(browserCommand(url, "linux")).toEqual({ command: "xdg-open", args: [url] });
    expect(browserCommand(url, "win32")).toEqual({ command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] });
    expect(browserCommand(url, "freebsd")).toBeUndefined();
  });
});
