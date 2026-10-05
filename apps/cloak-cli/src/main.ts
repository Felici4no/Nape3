import { readFile, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  address,
  createCloakRpc,
  generateKeyPairSigner,
  signerFromSecretKey,
  signMessageBytes,
  type CloakRpc,
  type KeyPairSigner
} from "@cloak.dev/sdk";
import { cents, formatBRL } from "@nape3/domain";
import { buildStaticPixBrCode, MockOfframp, MockWallet, PaymentRouter, USDC_MINT, formatUsdc } from "@nape3/payments";
import {
  CloakFunding,
  CloakKeys,
  cloakFundingSource,
  createCloakLogger,
  diagnosticFromError,
  diagnosticFromMessage,
  formatDiagnostic,
  createSimulatedCloakSdk,
  derivationMessageBytes,
  MemoryNoteStore,
  parseUsdc,
  PRIVACY_COPY,
  realCloakSdk,
  safeErrorMessage,
  seedFromWalletSignature,
  type CloakSdkPort,
  type NoteStore
} from "@nape3/payments/cloak";
import { FileNoteStore } from "./file-store";

/**
 * UPAY3FOOD.agent private funding CLI.
 *
 *   demo                      full flow with the SIMULATED SDK (no wallet, no network)
 *   balance [--reconcile]     shielded USDC balance from local notes (+ on-chain spent check)
 *   shield <usdc> [--yes]     REAL mainnet deposit of USDC into the Cloak pool
 *   fund <usdc> <address> [--yes]  REAL mainnet withdrawal from the pool to <address>
 *
 * Real commands need SOLANA_RPC_URL and KEYPAIR_PATH (a Solana CLI keypair
 * file). Raw private keys are never read from the environment. The Cloak key
 * is derived from the keypair's signature over a fixed message, so nothing
 * secret besides the keypair file and the notes file exists.
 */

const USDC = address(USDC_MINT["mainnet-beta"]);
const HOME = process.env.UPAY3FOOD_HOME ?? join(homedir(), ".upay3food", "cloak");
const log = createCloakLogger((line) => console.error(line));

function arg(flag: string) {
  return process.argv.includes(flag);
}

async function confirm(question: string): Promise<boolean> {
  if (arg("--yes")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} Type "yes" to continue: `);
  rl.close();
  return answer.trim().toLowerCase() === "yes";
}

async function loadKeypair(): Promise<KeyPairSigner> {
  const path = process.env.KEYPAIR_PATH;
  if (!path) throw new Error("Set KEYPAIR_PATH to a Solana CLI keypair file (never paste a private key in the environment).");
  return signerFromSecretKey(Uint8Array.from(JSON.parse(await readFile(path, "utf8")) as number[]));
}

/** Same derivation as the browser wallet flow: sign a fixed message, hash the signature. */
async function keysFor(keypair: KeyPairSigner): Promise<CloakKeys> {
  const signature = await signMessageBytes(keypair, derivationMessageBytes());
  return CloakKeys.fromSeed(await seedFromWalletSignature(signature));
}

async function realContext() {
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) throw new Error("Set SOLANA_RPC_URL to a mainnet RPC endpoint.");
  const keypair = await loadKeypair();
  const keys = await keysFor(keypair);
  const store = new FileNoteStore(join(HOME, `notes-${keypair.address}.json`));
  const funding = new CloakFunding({
    sdk: realCloakSdk,
    connection: createCloakRpc(rpcUrl),
    signer: { kind: "keypair", keypair },
    keys,
    store,
    mint: USDC,
    log
  });
  return { funding, keypair };
}

async function recordProof(entry: Record<string, string>) {
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  await appendFile(join(HOME, "proofs.jsonl"), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------

export async function runDemo(out: (line: string) => void = console.log, sdkOverride?: CloakSdkPort) {
  const { sdk } = sdkOverride ? { sdk: sdkOverride } : createSimulatedCloakSdk();
  const keypair = await generateKeyPairSigner();
  const keys = await keysFor(keypair);
  const store: NoteStore = new MemoryNoteStore();
  const funding = new CloakFunding({
    sdk,
    connection: {} as CloakRpc,
    signer: { kind: "keypair", keypair },
    keys,
    store,
    mint: USDC,
    log: createCloakLogger(() => {})
  });

  out("UPAY3FOOD.agent · private funding demo (SIMULATED: no wallet, no network, no real funds)\n");
  out(`1. Wallet connected: ${keypair.address} (throwaway)`);
  const shield = await funding.shield(parseUsdc("10"));
  out(`2. Shielded 10.000000 USDC into the Cloak pool → ${shield.signature}`);
  out(`   Shielded balance: ${formatUsdc(shield.balance.total)} in ${shield.balance.notes} note(s), persisted before success`);

  const total = cents(2779);
  const pix = buildStaticPixBrCode({ pixKey: "loja@example.com", merchantName: "ACAI DO BAIRRO", merchantCity: "SAO PAULO", amountCents: total });
  const router = new PaymentRouter(new MockWallet(0n), new MockOfframp(), "mainnet-beta", cloakFundingSource(funding, { simulated: true }));
  const now = new Date();
  const plan = await router.plan(pix, now);
  out(`3. Agent selected checkout ${formatBRL(total)}; Pix detected. Route:`);
  for (const step of plan.steps) out(`   - ${step}`);
  out(`   Cloak privacy cost: ${formatUsdc(plan.funding.costUsdc)}`);
  out(`\n   ${PRIVACY_COPY.headline}`);
  out(`   ${PRIVACY_COPY.whatIsHidden}`);
  out(`   ${PRIVACY_COPY.whatIsNotHidden}\n`);
  const payout = await router.execute(plan, { confirmedByUser: true, amountCents: total, at: now.toISOString() }, now);
  const balance = await funding.shieldedBalance();
  out(`4. User confirmed ${formatBRL(total)} → off-ramp funded from the pool; Pix payout ${payout.status} (${payout.reference})`);
  out(`   Remaining shielded balance: ${formatUsdc(balance.total)} (change note persisted)`);
  return { plan, payout, balance };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  switch (command) {
    case "demo":
      await runDemo();
      return;
    case "balance": {
      const { funding, keypair } = await realContext();
      const balance = arg("--reconcile") ? await funding.reconcileWithChain() : await funding.shieldedBalance();
      console.log(`Wallet ${keypair.address}`);
      console.log(`Shielded USDC: ${formatUsdc(balance.total)} in ${balance.notes} note(s)${balance.pending ? `, ${balance.pending} pending` : ""}`);
      return;
    }
    case "shield": {
      const amount = parseUsdc(rest[0] ?? "");
      const { funding, keypair } = await realContext();
      console.log(PRIVACY_COPY.headline);
      console.log(PRIVACY_COPY.tip);
      if (!(await confirm(`MAINNET: shield ${formatUsdc(amount)} from ${keypair.address} into the Cloak USDC pool?`))) return;
      const result = await funding.shield(amount);
      await recordProof({ kind: "shield", signature: result.signature, explorer: result.explorer, amount: amount.toString(), mint: USDC, at: new Date().toISOString() });
      console.log(`Shielded. Signature: ${result.signature}`);
      console.log(`Explorer: ${result.explorer}`);
      console.log(`Shielded balance: ${formatUsdc(result.balance.total)} (notes saved to ${HOME})`);
      return;
    }
    case "fund": {
      const net = parseUsdc(rest[0] ?? "");
      const recipient = address(rest[1] ?? "");
      const { funding } = await realContext();
      if (!(await confirm(`MAINNET: unshield so that ${recipient} receives ${formatUsdc(net)} (Cloak fee added)?`))) return;
      const result = await funding.fundPayment(recipient, net);
      await recordProof({ kind: "fund", signature: result.signature, explorer: result.explorer, net: net.toString(), gross: result.gross.toString(), at: new Date().toISOString() });
      console.log(`Funded. Signature: ${result.signature}\nExplorer: ${result.explorer}`);
      console.log(`Fee ${formatUsdc(result.fee)} · change kept shielded ${formatUsdc(result.change)}`);
      return;
    }
    case "decode": {
      // Offline: decodes a "Solana error #…; Decode this error by running …" line (argument or stdin).
      let text = rest.join(" ");
      if (!text) for await (const chunk of process.stdin) text += String(chunk);
      const diagnostic = diagnosticFromMessage(text);
      console.log(diagnostic ? formatDiagnostic(diagnostic) : "No encoded Solana error context found.");
      return;
    }
    default:
      console.log("usage: pnpm cloak <demo | balance [--reconcile] | shield <usdc> [--yes] | fund <usdc> <address> [--yes] | decode '<console line>'>");
  }
}

if (process.argv[1] && /main\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(safeErrorMessage(error));
    // Keep the RPC's own explanation (preflight logs, custom code) that the generic message hides.
    const diagnostic = diagnosticFromError(error);
    if (diagnostic) console.error(formatDiagnostic(diagnostic));
    process.exit(1);
  });
}
