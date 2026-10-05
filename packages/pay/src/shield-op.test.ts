import { describe, expect, it, vi } from "vitest";
import { CloakPersistenceError } from "@nape3/payments/cloak";
import { MemoryIntentStore, type IntentStore, type ShieldIntent } from "./shield-intent";
import { displayError, ShieldOperation, SHIELD_AMOUNT_USDC, SOL_RECOMMENDED_LAMPORTS, type ShieldDeps, type ShieldFunding } from "./shield-op";

const WALLET = { name: "Phantom", address: "9qAezschd4e5t5yi9F5SAw41g43Vuj6iYMh7dpcKqkUi" };
const NOW = new Date("2026-10-04T12:00:00Z");
const rejection = Object.assign(new Error("User rejected the request."), { code: 4001 });

type ShieldImpl = (amount: bigint, options: { onProgress: (stage: string) => void }) => Promise<{ signature: string }>;

/** Happy path as the SDK reports it: lookup table, deposit signature, send, confirm. */
const happyShield: ShieldImpl = async (_amount, { onProgress }) => {
  onProgress("Waiting for wallet signature (lookup table)...");
  onProgress("Waiting for wallet signature...");
  onProgress("Sending transaction...");
  onProgress("Confirming transaction...");
  return { signature: "SIG1" };
};

function setup(
  options: {
    usdc?: bigint;
    sol?: bigint;
    shield?: ShieldImpl;
    intents?: IntentStore;
    unlock?: () => Promise<ShieldFunding>;
    tx?: { slot: number; blockTime: number | null } | null;
  } = {}
) {
  let publicUsdc = options.usdc ?? 6_062_919n;
  let shielded = 0n;
  const shieldCalls: bigint[] = [];
  const impl = options.shield ?? happyShield;
  const funding: ShieldFunding = {
    shieldedUsdc: async () => shielded,
    shield: vi.fn(async (amount, o) => {
      shieldCalls.push(amount);
      const result = await impl(amount, o);
      publicUsdc -= amount;
      shielded += amount;
      return result;
    }),
    reconcile: async () => shielded
  };
  const intents = options.intents ?? new MemoryIntentStore();
  const deps: ShieldDeps = {
    connectWallet: vi.fn(async () => WALLET),
    readPublicBalances: async () => ({ publicUsdc, solLamports: options.sol ?? 12_895_810n }),
    unlock: vi.fn(options.unlock ?? (async () => funding)),
    readTransaction: vi.fn(async () => (options.tx === undefined ? { slot: 453_400_000, blockTime: 1_791_115_200 } : options.tx)),
    intents,
    provider: "rpc-fast",
    now: () => NOW,
    newId: () => "intent-1",
    sleep: async () => undefined
  };
  return { op: new ShieldOperation(deps), deps, funding, intents, shieldCalls, setPublic: (v: bigint) => (publicUsdc = v) };
}

async function toConfirmation(op: ShieldOperation) {
  await op.connect();
  await op.unlock();
  await op.prepare();
}

describe("ShieldOperation: happy path", () => {
  it("walks every state in order and records safe proof metadata", async () => {
    const { op, shieldCalls, intents } = setup();
    await toConfirmation(op);
    expect(op.state.state).toBe("USER_CONFIRMATION_REQUIRED");
    expect(op.state.summary).toEqual({
      network: "mainnet-beta",
      wallet: WALLET.address,
      operation: "Cloak shield",
      amountUsdc: "1.000000",
      publicUsdc: "6.062919",
      solBalance: "0.012895810",
      solRecommended: "0.003500000"
    });
    expect(shieldCalls).toEqual([]); // nothing sent before confirm

    await op.confirm();
    expect(shieldCalls).toEqual([SHIELD_AMOUNT_USDC]);
    expect(op.state.state).toBe("SHIELDED");
    expect(op.state.history).toEqual([
      "WALLET_REQUIRED",
      "WALLET_CONNECTED",
      "BALANCE_VERIFIED",
      "CLOAK_UNLOCK_REQUIRED",
      "CLOAK_READY",
      "SHIELD_PREPARED",
      "USER_CONFIRMATION_REQUIRED",
      "WALLET_SIGNATURE_REQUIRED",
      "WALLET_SIGNATURE_REQUIRED",
      "WALLET_SIGNATURE_REQUIRED",
      "SUBMITTING",
      "CONFIRMING",
      "CONFIRMING",
      "SHIELDED"
    ]);
    expect(op.state.proof).toEqual({
      network: "mainnet-beta",
      provider: "rpc-fast",
      operation: "cloak-shield",
      amountUsdc: "1.000000",
      walletAddress: WALLET.address,
      signature: "SIG1",
      slot: 453_400_000,
      confirmedAt: "2026-10-04T12:00:00.000Z"
    });
    expect(op.state.shieldedUsdc).toBe(1_000_000n);
    expect(intents.read(WALLET.address)?.status).toBe("done");
  });

  it("tells the lookup-table approval apart from the shield approval", async () => {
    const stages: string[] = [];
    const { op } = setup();
    op.subscribe((v) => v.stage && stages.push(v.stage));
    await toConfirmation(op);
    await op.confirm();
    expect(stages.some((s) => /lookup-table transaction.*no USDC moves/i.test(s))).toBe(true);
    expect(stages.some((s) => /Approve the 1\.000000 USDC shield/.test(s))).toBe(true);
  });

  it("still reports SHIELDED when the RPC cannot return the transaction (slot unknown)", async () => {
    const { op } = setup({ tx: null });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.state).toBe("SHIELDED");
    expect(op.state.proof?.slot).toBeNull();
    expect(op.state.notice).toMatch(/slot is unknown/);
  });
});

describe("ShieldOperation: idempotency", () => {
  it("a double click sends exactly one shield", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { op, shieldCalls } = setup({
      shield: async (a, o) => {
        await gate;
        return happyShield(a, o);
      }
    });
    await toConfirmation(op);
    const first = op.confirm();
    const second = op.confirm();
    const third = op.confirm();
    release();
    await Promise.all([first, second, third]);
    expect(shieldCalls).toHaveLength(1);
    expect(op.state.state).toBe("SHIELDED");
  });

  it("confirm is a no-op before the summary is shown", async () => {
    const { op, shieldCalls } = setup();
    await op.connect();
    await op.confirm();
    await op.unlock();
    await op.confirm();
    expect(shieldCalls).toEqual([]);
    expect(op.state.state).toBe("CLOAK_READY");
  });

  it("after SHIELDED, confirm cannot send a second one", async () => {
    const { op, shieldCalls } = setup();
    await toConfirmation(op);
    await op.confirm();
    await op.confirm();
    expect(shieldCalls).toHaveLength(1);
  });

  it("a refresh mid-flight (record left as 'sent') blocks a new shield until checked on chain", async () => {
    const intents = new MemoryIntentStore();
    const stale: ShieldIntent = { id: "old", amountUsdc: "1000000", status: "sent", startedAt: NOW.toISOString(), publicUsdcBefore: "6062919" };
    intents.write(WALLET.address, stale);
    const { op, shieldCalls, setPublic } = setup({ intents });
    await op.connect();
    expect(op.state.state).toBe("FAILED");
    expect(op.state.failure).toMatchObject({ code: "attempt-unresolved", blocking: true });

    await op.reset(); // blocking failures cannot be reset
    expect(op.state.state).toBe("FAILED");
    await op.unlock();
    await op.confirm();
    expect(shieldCalls).toEqual([]);

    // The earlier attempt landed: public USDC dropped by exactly 1 USDC → stays blocked.
    setPublic(5_062_919n);
    await op.checkPending();
    expect(op.state.state).toBe("FAILED");
    expect(op.state.notice).toMatch(/landed\. Do not retry/);
    expect(intents.read(WALLET.address)).not.toBeNull();
  });

  it("checkPending unblocks only when public USDC is unchanged", async () => {
    const intents = new MemoryIntentStore();
    intents.write(WALLET.address, { id: "old", amountUsdc: "1000000", status: "signing", startedAt: NOW.toISOString(), publicUsdcBefore: "6062919" });
    const { op } = setup({ intents });
    await op.connect();
    expect(op.state.failure?.blocking).toBe(true);
    await op.checkPending();
    expect(op.state.state).toBe("CLOAK_UNLOCK_REQUIRED");
    expect(intents.read(WALLET.address)).toBeNull();
  });

  it("an unexplained balance change keeps the block", async () => {
    const intents = new MemoryIntentStore();
    intents.write(WALLET.address, { id: "old", amountUsdc: "1000000", status: "sent", startedAt: NOW.toISOString(), publicUsdcBefore: "9000000" });
    const { op } = setup({ intents });
    await op.connect();
    await op.checkPending();
    expect(op.state.state).toBe("FAILED");
    expect(op.state.notice).toMatch(/does not explain/);
  });

  it("reconnecting after a completed shield shows its proof and sends nothing", async () => {
    const first = setup();
    await toConfirmation(first.op);
    await first.op.confirm();

    const second = setup({ intents: first.intents });
    await second.op.connect();
    expect(second.op.state.state).toBe("SHIELDED");
    expect(second.op.state.proof?.signature).toBe("SIG1");
    await second.op.confirm();
    expect(second.shieldCalls).toEqual([]);
  });

  it("startAnother is the only way to a second shield after one completed", async () => {
    const { op, shieldCalls } = setup({ usdc: 9_000_000n });
    await toConfirmation(op);
    await op.confirm();
    await op.startAnother();
    expect(op.state.state).toBe("CLOAK_UNLOCK_REQUIRED");
    await op.unlock();
    await op.prepare();
    await op.confirm();
    expect(shieldCalls).toHaveLength(2);
  });

  it("fails closed when the attempt record cannot be saved: nothing is signed", async () => {
    const broken: IntentStore = {
      read: () => null,
      write: () => {
        throw new Error("quota");
      },
      clear: () => undefined
    };
    const { op, shieldCalls } = setup({ intents: broken });
    await toConfirmation(op);
    await op.confirm();
    expect(shieldCalls).toEqual([]);
    expect(op.state.failure).toMatchObject({ code: "record-unwritable", blocking: false });
  });

  it("fails closed when the attempt record cannot be read", async () => {
    const unreadable: IntentStore = {
      read: () => {
        throw new Error("corrupt");
      },
      write: () => undefined,
      clear: () => undefined
    };
    const { op, shieldCalls } = setup({ intents: unreadable });
    await op.connect();
    expect(op.state.failure).toMatchObject({ code: "record-unreadable", blocking: true });
    expect(shieldCalls).toEqual([]);
  });
});

describe("ShieldOperation: failures", () => {
  it("cancelling in the wallet leaves nothing behind and allows a deliberate new try", async () => {
    let attempts = 0;
    const { op, intents, shieldCalls } = setup({
      shield: async (a, o) => {
        attempts += 1;
        if (attempts === 1) {
          o.onProgress("Waiting for wallet signature...");
          throw rejection;
        }
        return happyShield(a, o);
      }
    });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.state).toBe("FAILED");
    expect(op.state.failure).toMatchObject({ code: "rejected", blocking: false });
    expect(intents.read(WALLET.address)).toBeNull();

    await op.reset();
    expect(op.state.state).toBe("CLOAK_UNLOCK_REQUIRED");
    await op.unlock();
    await op.prepare();
    await op.confirm();
    expect(op.state.state).toBe("SHIELDED");
    expect(shieldCalls).toHaveLength(2);
  });

  it("an error after the transaction was sent blocks any retry", async () => {
    const { op, intents, shieldCalls } = setup({
      shield: async (_a, o) => {
        o.onProgress("Waiting for wallet signature...");
        o.onProgress("Sending transaction...");
        throw new Error("blockhash not found");
      }
    });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.failure).toMatchObject({ code: "outcome-unknown", blocking: true });
    expect(intents.read(WALLET.address)?.status).toBe("sent");

    await op.reset();
    await op.confirm();
    expect(shieldCalls).toHaveLength(1);
    expect(op.state.state).toBe("FAILED");
  });

  it("an error before anything was sent (proof/RPC) is safe to retry", async () => {
    const { op, intents } = setup({
      shield: async () => {
        throw new Error("prover unavailable");
      }
    });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.failure).toMatchObject({ code: "failed-before-broadcast", blocking: false });
    expect(intents.read(WALLET.address)).toBeNull();
  });

  it("confirmed but notes not saved: blocking, with the signature", async () => {
    const { op, intents } = setup({
      shield: async (_a, o) => {
        o.onProgress("Sending transaction...");
        throw new CloakPersistenceError("Transaction confirmed but its output notes could not be saved. Do not retry.", "SIGX");
      }
    });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.failure).toMatchObject({ code: "notes-not-saved", blocking: true });
    expect(op.state.failure?.message).toContain("SIGX");
    expect(intents.read(WALLET.address)?.signature).toBe("SIGX");
    await op.checkPending();
    expect(op.state.state).toBe("FAILED");
  });

  it("insufficient USDC or SOL stops before any signature", async () => {
    const lowUsdc = setup({ usdc: 999_999n });
    await lowUsdc.op.connect();
    expect(lowUsdc.op.state.failure).toMatchObject({ code: "insufficient-usdc", blocking: false });
    expect(lowUsdc.deps.unlock).not.toHaveBeenCalled();

    const lowSol = setup({ sol: SOL_RECOMMENDED_LAMPORTS - 1n });
    await lowSol.op.connect();
    expect(lowSol.op.state.failure).toMatchObject({ code: "insufficient-sol", blocking: false });
  });

  it("rejecting the unlock signature keeps the step and sends nothing", async () => {
    const { op, shieldCalls } = setup({
      unlock: async () => {
        throw rejection;
      }
    });
    await op.connect();
    await op.unlock();
    expect(op.state.state).toBe("CLOAK_UNLOCK_REQUIRED");
    expect(op.state.notice).toMatch(/cancelled/i);
    expect(shieldCalls).toEqual([]);
  });

  it("cancel from the confirmation signs and sends nothing", async () => {
    const { op, shieldCalls } = setup();
    await toConfirmation(op);
    op.cancel();
    expect(op.state.state).toBe("CLOAK_READY");
    await op.confirm();
    expect(shieldCalls).toEqual([]);
  });
});

describe("displayError", () => {
  it("never shows an RPC URL or its API key", () => {
    const text = displayError(new Error("fetch failed for https://solana-rpc.rpcfast.com/?api_key=SECRETKEY123 (ENOTFOUND)"));
    expect(text).not.toContain("SECRETKEY123");
    expect(text).not.toContain("rpcfast.com");
    expect(text).toContain("[url]");
  });
});

describe("ShieldOperation: relay lookup-table path (plan B)", () => {
  it("shows the relay stages, then exactly one wallet approval", async () => {
    const { op } = setup({
      shield: async (_amount, { onProgress }) => {
        onProgress("Generating ZK proof...");
        onProgress("relay:FETCHING_RISK_QUOTE");
        onProgress("Fetching risk quote from backend...");
        onProgress("relay:PREPARING_RELAY_ALT");
        onProgress("relay:WAITING_FOR_ALT_WARMUP");
        onProgress("Waiting for wallet signature...");
        onProgress("relay:CHECKING_QUOTE_FRESHNESS");
        onProgress("relay:WALLET_SIGNATURE_REQUIRED");
        onProgress("Sending transaction...");
        onProgress("Confirming transaction...");
        return { signature: "SIG1" };
      }
    });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.state).toBe("SHIELDED");
    const afterConfirm = op.state.history.slice(op.state.history.indexOf("USER_CONFIRMATION_REQUIRED") + 1);
    expect(afterConfirm).toEqual([
      "WALLET_SIGNATURE_REQUIRED", // "generating the proof…" on confirm
      "FETCHING_RISK_QUOTE",
      "PREPARING_RELAY_ALT",
      "WAITING_FOR_ALT_WARMUP",
      "WALLET_SIGNATURE_REQUIRED",
      "CHECKING_QUOTE_FRESHNESS",
      "WALLET_SIGNATURE_REQUIRED",
      "SUBMITTING",
      "CONFIRMING",
      "CONFIRMING",
      "SHIELDED"
    ]);
  });

  it("a guard abort before broadcast is a non-blocking failure that names the violation; the record is cleared", async () => {
    const { RelayShieldAbort } = await import("./relay-shield-guard");
    const { op, intents } = setup({
      shield: async (_amount, { onProgress }) => {
        onProgress("relay:PREPARING_RELAY_ALT");
        throw new RelayShieldAbort("RELAY_ALT_FALLBACK_BLOCKED", "The relay lookup table was not available, and the wallet-paid fallback is disabled.", true);
      }
    });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.state).toBe("FAILED");
    expect(op.state.failure).toMatchObject({ code: "relay_alt_fallback_blocked", blocking: false });
    expect(intents.read(WALLET.address)).toBeNull();
  });

  it("a refused second signature after the first was sent stays blocking (outcome unknown)", async () => {
    const { RelayShieldAbort } = await import("./relay-shield-guard");
    const { op, intents } = setup({
      shield: async (_amount, { onProgress }) => {
        onProgress("Waiting for wallet signature...");
        onProgress("Sending transaction...");
        throw new RelayShieldAbort("SECOND_SIGNATURE_BLOCKED", "The SDK asked for a second wallet signature.", false);
      }
    });
    await toConfirmation(op);
    await op.confirm();
    expect(op.state.failure).toMatchObject({ code: "second_signature_blocked", blocking: true });
    expect(intents.read(WALLET.address)?.status).toBe("sent");
  });

  it("asks for the measured SOL (0.0035), not the old 0.01 estimate", async () => {
    const enough = setup({ sol: 8_265_410n });
    await toConfirmation(enough.op);
    expect(enough.op.state.state).toBe("USER_CONFIRMATION_REQUIRED");
    expect(enough.op.state.summary?.solRecommended).toBe("0.003500000");
  });
});
