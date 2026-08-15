import type { McpAuthPort } from "./mcpClient.js";
import type { McpServerConfig } from "./mcpConfig.js";

export interface McpOAuthGrant {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface McpOAuthHost {
  authorize(config: McpServerConfig): Promise<McpOAuthGrant>;
  refresh?(config: McpServerConfig, grant: McpOAuthGrant): Promise<McpOAuthGrant>;
}

export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export function oauthSecretKey(config: McpServerConfig): string {
  const ref = config.auth?.tokenRef;
  if (ref?.startsWith("secret:")) return ref.slice("secret:".length);
  return `ninjacode.mcp.${config.name}.token`;
}

export function createOAuthAuthPort(host: McpOAuthHost, store: SecretStore): McpAuthPort {
  return {
    async token(config) {
      const stored = await store.get(oauthSecretKey(config));
      if (stored) {
        const grant = JSON.parse(stored) as McpOAuthGrant;
        if (!grant.expiresAt || grant.expiresAt > Date.now() + 30_000) return grant.accessToken;
        if (host.refresh && grant.refreshToken) {
          const refreshed = await host.refresh(config, grant);
          await store.set(oauthSecretKey(config), JSON.stringify(refreshed));
          return refreshed.accessToken;
        }
      }
      const grant = await host.authorize(config);
      await store.set(oauthSecretKey(config), JSON.stringify(grant));
      return grant.accessToken;
    },
    async onUnauthorized(config) {
      await store.delete(oauthSecretKey(config));
    },
  };
}

export async function deviceCodeGrant(opts: {
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes?: string[];
  fetch?: typeof fetch;
  onUserCode: (info: { userCode: string; verificationUri: string }) => Promise<void>;
}): Promise<McpOAuthGrant> {
  const http = opts.fetch ?? fetch;
  const started = await http(opts.deviceAuthorizationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: opts.clientId,
      scope: (opts.scopes ?? []).join(" "),
    }),
  });
  const device = (await started.json()) as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    interval?: number;
  };
  await opts.onUserCode({ userCode: device.user_code, verificationUri: device.verification_uri });
  const intervalMs = Math.max(0, device.interval ?? 5) * 1000;
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    const tokenRes = await http(opts.tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: device.device_code,
        client_id: opts.clientId,
      }),
    });
    const token = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (token.access_token) {
      return {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
      };
    }
    if (token.error && token.error !== "authorization_pending" && token.error !== "slow_down") {
      throw new Error(`OAuth device flow failed: ${token.error}`);
    }
  }
  throw new Error("OAuth device flow timed out");
}

export function createMemorySecretStore(initial: Record<string, string> = {}): SecretStore {
  const data = { ...initial };
  return {
    async get(key) {
      return data[key];
    },
    async set(key, value) {
      data[key] = value;
    },
    async delete(key) {
      delete data[key];
    },
  };
}

export function createDeviceOAuthHost(opts: {
  onUserCode: (info: { userCode: string; verificationUri: string }) => Promise<void>;
  fetch?: typeof fetch;
}): McpOAuthHost {
  return {
    async authorize(config) {
      const auth = config.auth;
      if (
        auth?.flow === "device_code" &&
        auth.deviceAuthorizationEndpoint &&
        auth.tokenEndpoint &&
        auth.clientId
      ) {
        return deviceCodeGrant({
          deviceAuthorizationEndpoint: auth.deviceAuthorizationEndpoint,
          tokenEndpoint: auth.tokenEndpoint,
          clientId: auth.clientId,
          scopes: auth.scopes,
          fetch: opts.fetch,
          onUserCode: opts.onUserCode,
        });
      }
      throw new Error(
        `MCP server ${config.name} requires OAuth. Configure device_code endpoints or a stored token.`,
      );
    },
  };
}
