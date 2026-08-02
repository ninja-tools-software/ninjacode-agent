import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  expandEnvRefs,
  loadMcpConfig,
  loadMcpConfigFile,
  removeMcpServer,
  setMcpServerEnabled,
  upsertMcpServer,
  validateMcpServer,
  writeMcpConfig,
} from "./mcpConfig.js";
import { loadMcpToolsWithStatus } from "./mcp.js";

const dirs: string[] = [];

async function tmpWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nc-mcp-"));
  dirs.push(dir);
  return dir;
}

async function writeConfig(root: string, rel: string, content: unknown): Promise<string> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(content, null, 2), "utf8");
  return file;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});

describe("loadMcpConfigFile", () => {
  it("prefers .ninjacode/mcp.json and reports the file it used", async () => {
    const root = await tmpWorkspace();
    await writeConfig(root, ".mcp.json", { mcpServers: { legacy: { command: "old" } } });
    await writeConfig(root, ".ninjacode/mcp.json", { mcpServers: { current: { command: "new" } } });

    const { file, servers } = await loadMcpConfigFile(root);
    expect(path.relative(root, file!)).toBe(path.join(".ninjacode", "mcp.json"));
    expect(servers.map((s) => s.name)).toEqual(["current"]);
  });

  it("returns disabled servers too, so the settings UI can list them", async () => {
    const root = await tmpWorkspace();
    await writeConfig(root, ".ninjacode/mcp.json", {
      mcpServers: { off: { command: "x", enabled: false } },
    });
    const servers = await loadMcpConfig(root);
    expect(servers).toEqual([{ name: "off", command: "x", enabled: false }]);
  });
});

describe("validateMcpServer", () => {
  it("accepts a valid stdio and http server", () => {
    expect(validateMcpServer({ name: "fs", command: "npx" })).toEqual([]);
    expect(validateMcpServer({ name: "remote", transport: "http", url: "https://x/mcp" })).toEqual([]);
  });

  it("rejects missing names, bad names, and missing endpoints", () => {
    expect(validateMcpServer({ name: "" })).toContain("Name is required");
    expect(validateMcpServer({ name: "has space", command: "x" }).join()).toMatch(/letters, digits/);
    expect(validateMcpServer({ name: "fs" })).toContain("Command is required for the stdio transport");
    expect(validateMcpServer({ name: "r", transport: "http" })).toContain(
      "URL is required for the http transport",
    );
    expect(validateMcpServer({ name: "r", transport: "http", url: "ftp://x" })).toContain(
      "URL must start with http(s)://",
    );
  });
});

describe("writing the MCP config", () => {
  it("creates .ninjacode/mcp.json when the workspace has none", async () => {
    const root = await tmpWorkspace();
    const file = await upsertMcpServer(root, { name: "fs", command: "npx", args: ["-y", "pkg"] });
    expect(path.relative(root, file)).toBe(path.join(".ninjacode", "mcp.json"));
    expect(await loadMcpConfig(root)).toEqual([{ name: "fs", command: "npx", args: ["-y", "pkg"] }]);
  });

  it("writes back to the legacy .mcp.json when that is the file in use", async () => {
    const root = await tmpWorkspace();
    await writeConfig(root, ".mcp.json", { mcpServers: {} });
    const file = await upsertMcpServer(root, { name: "fs", command: "npx" });
    expect(path.relative(root, file)).toBe(".mcp.json");
  });

  it("renames an entry without duplicating it", async () => {
    const root = await tmpWorkspace();
    await upsertMcpServer(root, { name: "old", command: "npx" });
    await upsertMcpServer(root, { name: "new", command: "npx" }, "old");
    expect((await loadMcpConfig(root)).map((s) => s.name)).toEqual(["new"]);
  });

  it("rejects an invalid server instead of writing it", async () => {
    const root = await tmpWorkspace();
    await expect(upsertMcpServer(root, { name: "broken" })).rejects.toThrow(/Command is required/);
    expect(await loadMcpConfig(root)).toEqual([]);
  });

  it("toggles and removes servers, and keeps unrelated top-level keys", async () => {
    const root = await tmpWorkspace();
    const file = await writeConfig(root, ".ninjacode/mcp.json", {
      note: "keep me",
      mcpServers: { fs: { command: "npx" }, other: { command: "cat" } },
    });

    await setMcpServerEnabled(root, "fs", false);
    expect((await loadMcpConfig(root)).find((s) => s.name === "fs")?.enabled).toBe(false);

    await removeMcpServer(root, "other");
    expect((await loadMcpConfig(root)).map((s) => s.name)).toEqual(["fs"]);

    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    expect(parsed.note).toBe("keep me");
  });

  it("round-trips through writeMcpConfig", async () => {
    const root = await tmpWorkspace();
    const servers = [
      { name: "fs", command: "npx", args: ["-y", "pkg"], env: { TOKEN: "${env:TOKEN}" } },
      { name: "remote", transport: "http" as const, url: "https://x/mcp", enabled: false },
    ];
    await writeMcpConfig(root, servers);
    expect(await loadMcpConfig(root)).toEqual(servers);
  });
});

describe("loadMcpToolsWithStatus", () => {
  it("reports disabled servers without trying to connect", async () => {
    const { tools, clients, statuses } = await loadMcpToolsWithStatus([
      { name: "off", command: "definitely-not-a-real-binary", enabled: false },
    ]);
    expect(tools).toEqual([]);
    expect(clients).toEqual([]);
    expect(statuses).toEqual([
      {
        name: "off",
        transport: "stdio",
        status: "disabled",
        toolCount: 0,
        tools: [],
        resources: [],
        prompts: [],
        config: { name: "off", command: "definitely-not-a-real-binary", enabled: false },
      },
    ]);
  });
});

describe("expandEnvRefs", () => {
  it("substitutes ${env:NAME} from the environment", () => {
    process.env.NC_TEST_TOKEN = "s3cret";
    expect(expandEnvRefs({ Authorization: "Bearer ${env:NC_TEST_TOKEN}" })).toEqual({
      Authorization: "Bearer s3cret",
    });
    delete process.env.NC_TEST_TOKEN;
  });

  it("collapses unknown variables and leaves plain values alone", () => {
    expect(expandEnvRefs({ a: "${env:NC_MISSING_VAR}", b: "plain" })).toEqual({ a: "", b: "plain" });
    expect(expandEnvRefs(undefined)).toBeUndefined();
  });
});
