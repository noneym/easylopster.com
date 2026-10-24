#!/usr/bin/env node
/**
 * easylopster node agent CLI.
 *
 *   easylopster-node connect <PAIRING-CODE> [--gateway wss://gw.easylopster.com/ws] [--workspace ./dir] [--name laptop]
 *   easylopster-node run                     (uses the saved token, or EASYLOPSTER_TOKEN)
 *   easylopster-node status
 *
 * Environment (Docker friendly): EASYLOPSTER_GATEWAY, EASYLOPSTER_PAIRING_CODE, EASYLOPSTER_TOKEN,
 * EASYLOPSTER_WORKSPACE, EASYLOPSTER_NAME, EASYLOPSTER_CONFIG (config file path).
 */
import os from "node:os";
import path from "node:path";
import { DEFAULT_GATEWAY, VERSION, createNodeAgent, defaultConfigPath, defaultWorkspace, loadConfig, saveConfig, type NodeConfig } from "./agent";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function runForever(cfg: NodeConfig, configPath: string, pairingCode?: string): Promise<never> {
  const agent = createNodeAgent({
    config: cfg,
    configPath,
    pairingCode,
    onStatus: (s) => {
      if (s.state === "auth_failed") {
        console.error("Authentication failed. Get a new pairing code from the dashboard and run `connect <CODE>` again.");
        process.exit(2);
      }
    },
  });
  process.once("SIGINT", () => void agent.stop().then(() => process.exit(0)));
  process.once("SIGTERM", () => void agent.stop().then(() => process.exit(0)));
  agent.start();
  return new Promise<never>(() => {});
}

async function main() {
  const configPath = defaultConfigPath();
  const cmd = process.argv[2] ?? (process.env.EASYLOPSTER_PAIRING_CODE || process.env.EASYLOPSTER_TOKEN ? "run" : "help");
  const saved = await loadConfig(configPath);
  const cfg: NodeConfig = {
    gateway: arg("--gateway") ?? process.env.EASYLOPSTER_GATEWAY ?? saved.gateway ?? DEFAULT_GATEWAY,
    token: process.env.EASYLOPSTER_TOKEN ?? saved.token,
    workspace: path.resolve((arg("--workspace") ?? process.env.EASYLOPSTER_WORKSPACE ?? saved.workspace ?? defaultWorkspace()).replace(/^~(?=$|[\\/])/, os.homedir())),
    name: arg("--name") ?? process.env.EASYLOPSTER_NAME ?? saved.name ?? os.hostname(),
  };

  if (cmd === "connect") {
    const code = (process.argv[3] ?? process.env.EASYLOPSTER_PAIRING_CODE ?? "").toUpperCase();
    if (!code) return console.error("usage: easylopster-node connect <PAIRING-CODE> [--gateway url] [--workspace dir] [--name name]");
    cfg.token = undefined;
    await saveConfig(configPath, cfg);
    await runForever(cfg, configPath, code);
  } else if (cmd === "run") {
    if (!cfg.token && process.env.EASYLOPSTER_PAIRING_CODE) {
      await saveConfig(configPath, cfg);
      await runForever(cfg, configPath, process.env.EASYLOPSTER_PAIRING_CODE.toUpperCase());
    }
    if (!cfg.token) return console.error("No token saved. Run `easylopster-node connect <PAIRING-CODE>` first.");
    await runForever(cfg, configPath);
  } else if (cmd === "status") {
    console.log(JSON.stringify({ configPath, gateway: cfg.gateway, workspace: cfg.workspace, name: cfg.name, paired: !!cfg.token, version: VERSION }, null, 2));
  } else {
    console.log(`easylopster-node ${VERSION}

  connect <PAIRING-CODE> [--gateway url] [--workspace dir] [--name name]   pair this machine
  run                                                                      start with the saved token
  status                                                                   show configuration

Config: ${configPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
