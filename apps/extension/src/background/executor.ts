import type { AgentBrowserCommand, BrowserResultBody } from "@nape3/agent";
import { createLogger, errorMessage } from "../shared/log";
import { answerCommand } from "../shared/executor";
import type { ExtensionMessage, ExtensionResponse, ExtensionSettings, PageSnapshot } from "../shared/types";

/**
 * Browser executor for agent-api runs. Polls the runtime for commands bound
 * to this install, answers them from the user's own iFood tab and posts the
 * results. The executor token stays in chrome.storage.local and is only sent
 * to the configured agent-api. Nothing from iFood's session (cookies,
 * tokens, URLs) is ever sent.
 */

const log = createLogger("executor");
const ALARM = "agent-executor-poll";
/** While a run is active, poll this often (the service worker may still sleep; the alarm is the backstop). */
const ACTIVE_POLL_MS = 3_000;
const ACTIVE_WINDOW_MS = 10 * 60_000;

interface Credentials {
  apiUrl: string;
  executorId: string;
  executorToken: string;
}

let activeUntil = 0;
let polling = false;
const opened = new Set<string>();
const lastReported = new Map<string, string>();

async function credentials(settings: ExtensionSettings): Promise<Credentials | null> {
  const apiUrl = settings.agentApiUrl;
  if (!apiUrl) return null;
  const { executor } = await chrome.storage.local.get("executor");
  const stored = executor as Credentials | undefined;
  if (stored && stored.apiUrl === apiUrl) return stored;
  const response = await fetch(new URL("/agent/executors", apiUrl), { method: "POST", credentials: "omit" });
  if (!response.ok) throw new Error(`agent-api registration answered ${response.status}`);
  const body = (await response.json()) as { executorId: string; executorToken: string };
  const fresh = { apiUrl, executorId: body.executorId, executorToken: body.executorToken };
  await chrome.storage.local.set({ executor: fresh });
  log.info("executor.registered", { executorId: fresh.executorId });
  return fresh;
}

/** Exposed to the web app (same allowed origin as UPAY3FOOD Pay) so it can bind a run to this browser. */
export async function executorIdentity(settings: ExtensionSettings): Promise<{ executorId: string; agentApiUrl: string } | null> {
  const creds = await credentials(settings);
  return creds ? { executorId: creds.executorId, agentApiUrl: creds.apiUrl } : null;
}

async function ifoodSnapshot(): Promise<PageSnapshot | null> {
  const tabs = await chrome.tabs.query({ url: "https://*.ifood.com.br/*" });
  const tab = tabs.find((t) => t.active) ?? tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
  if (tab?.id === undefined) return null;
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: "GET_SNAPSHOT" } satisfies ExtensionMessage)) as ExtensionResponse;
    return response.ok && response.type === "SNAPSHOT" ? response.snapshot : null;
  } catch {
    return null; // content script not ready (tab loading)
  }
}

async function post(creds: Credentials, command: AgentBrowserCommand, result: BrowserResultBody) {
  const response = await fetch(new URL(`/agent/runs/${encodeURIComponent(command.runId)}/browser-result`, creds.apiUrl), {
    method: "POST",
    credentials: "omit",
    headers: { "content-type": "application/json", authorization: `Bearer ${creds.executorToken}` },
    body: JSON.stringify({ ...result, commandId: command.commandId })
  });
  log.info("executor.result", { command: command.type, result: result.type, status: response.status });
}

export async function pollAgent(settings: ExtensionSettings, observerId: string, reason: string): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const creds = await credentials(settings);
    if (!creds) return;
    const response = await fetch(new URL("/agent/executors/me/commands", creds.apiUrl), {
      credentials: "omit",
      headers: { authorization: `Bearer ${creds.executorToken}` },
      signal: AbortSignal.timeout(5_000)
    });
    if (response.status === 401) {
      await chrome.storage.local.remove("executor"); // re-register next time
      return;
    }
    const { commands } = (await response.json()) as { commands: AgentBrowserCommand[] };
    if (commands.length) activeUntil = Date.now() + ACTIVE_WINDOW_MS;
    for (const command of commands) {
      if (command.type === "REVALIDATE_CANDIDATE" && !lastReported.has(command.commandId)) await post(creds, command, { type: "STARTED" });
      const decision = await answerCommand(command, await ifoodSnapshot(), settings, observerId);
      if (decision.open && !opened.has(command.commandId)) {
        opened.add(command.commandId);
        await chrome.tabs.create({ url: decision.open, active: true });
      }
      // Report "needs user" once per reason; final results always.
      const key = `${decision.result.type}:${"reason" in decision.result ? decision.result.reason : ""}`;
      if (decision.result.type === "NEEDS_USER" && lastReported.get(command.commandId) === key) continue;
      lastReported.set(command.commandId, key);
      await post(creds, command, decision.result);
    }
    log.info("executor.polled", { reason, commands: commands.length });
  } catch (error) {
    log.warn("executor.poll_failed", { error: errorMessage(error) });
  } finally {
    polling = false;
  }
}

/** Starts the alarm backstop and a short active loop. Call on startup and whenever a run may have started. */
export function scheduleExecutor(getSettings: () => Promise<ExtensionSettings>, getObserverId: () => Promise<string>) {
  void chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM) void tick("alarm");
  });
  async function tick(reason: string) {
    const settings = await getSettings();
    if (settings.agentApiUrl) await pollAgent(settings, await getObserverId(), reason);
  }
  const loop = () => {
    if (Date.now() < activeUntil) void tick("active").finally(() => setTimeout(loop, ACTIVE_POLL_MS));
  };
  return {
    /** A page changed or the web app started a run: poll now and keep polling for a while. */
    nudge(reason: string) {
      const wasIdle = Date.now() >= activeUntil;
      activeUntil = Date.now() + ACTIVE_WINDOW_MS;
      void tick(reason);
      if (wasIdle) setTimeout(loop, ACTIVE_POLL_MS);
    }
  };
}
