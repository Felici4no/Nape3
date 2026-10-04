import { useEffect, useMemo, useState } from "react";
import { address, createCloakRpc } from "@cloak.dev/sdk";
import { cents, formatBRL } from "@nape3/domain";
import { MockOfframp, USDC_MINT, formatUsdc, type OfframpQuote } from "@nape3/payments";
import {
  CloakFunding,
  CloakKeys,
  createCloakLogger,
  derivationMessageBytes,
  grossUpWithdrawal,
  parseUsdc,
  PRIVACY_COPY,
  realCloakSdk,
  safeErrorMessage,
  seedFromWalletSignature,
  USDC_MIN_DEPOSIT,
  type ShieldedBalance
} from "@nape3/payments/cloak";
import { EncryptedLocalNoteStore } from "./encrypted-store";
import { connectWallet, findWallet, type ConnectedWallet } from "./wallet";

const USDC = address(USDC_MINT["mainnet-beta"]);
const RPC_KEY = "upay3food.rpc";

/** Purchase handed over by the extension in the URL fragment (never sent to a server). */
function purchaseFromHash(): { amountCents: number; merchant: string | null } | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const amount = Number(params.get("amountCents"));
  return Number.isSafeInteger(amount) && amount > 0 ? { amountCents: amount, merchant: params.get("merchant") } : null;
}

const log = createCloakLogger((line) => console.info(line));

export function App() {
  const purchase = useMemo(purchaseFromHash, []);
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [funding, setFunding] = useState<CloakFunding | null>(null);
  const [balance, setBalance] = useState<ShieldedBalance | null>(null);
  const [rpcUrl, setRpcUrl] = useState(() => localStorage.getItem(RPC_KEY) ?? "");
  const [shieldInput, setShieldInput] = useState("10");
  const [quote, setQuote] = useState<OfframpQuote | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ signature: string; explorer: string } | null>(null);

  useEffect(() => {
    if (!purchase) return;
    void new MockOfframp().quote(cents(purchase.amountCents), new Date()).then(setQuote);
  }, [purchase]);

  async function step<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(safeErrorMessage(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const connect = () => step("Connecting wallet…", async () => setWallet(await connectWallet()));

  const unlock = () =>
    step("Waiting for your wallet signature…", async () => {
      if (!wallet) return;
      if (!rpcUrl) throw new Error("Enter a Solana mainnet RPC URL first.");
      localStorage.setItem(RPC_KEY, rpcUrl);
      // One signature: derives the Cloak key AND the local encryption key. It authorizes nothing on-chain.
      const signature = await wallet.signMessage(derivationMessageBytes());
      const keys = await CloakKeys.fromSeed(await seedFromWalletSignature(signature));
      const store = await EncryptedLocalNoteStore.create(wallet.address, signature);
      const instance = new CloakFunding({
        sdk: realCloakSdk,
        connection: createCloakRpc(rpcUrl),
        signer: wallet.cloakSigner(),
        keys,
        store,
        mint: USDC,
        log
      });
      setFunding(instance);
      setBalance(await instance.shieldedBalance());
    });

  const reconcile = () => step("Checking notes on-chain…", async () => funding && setBalance(await funding.reconcileWithChain()));

  const shield = () =>
    step("Shielding — approve in your wallet, then the proof is generated…", async () => {
      if (!funding) return;
      const result = await funding.shield(parseUsdc(shieldInput));
      setBalance(result.balance);
      setLastTx({ signature: result.signature, explorer: result.explorer });
    });

  const required = quote ? grossUpWithdrawal(quote.usdcRequired) : null;

  return (
    <main>
      <header>
        <span className="eyebrow">UPAY3FOOD.agent · Private funding</span>
        <h1>{PRIVACY_COPY.headline}</h1>
        <p className="muted">Cloak shielded pool on Solana mainnet · USDC</p>
      </header>

      {purchase && (
        <section>
          <h2>Purchase</h2>
          <div className="kv"><span>{purchase.merchant ?? "Checkout"}</span><strong>{formatBRL(cents(purchase.amountCents))}</strong></div>
          {quote && required !== null && (
            <>
              <div className="kv small"><span>Off-ramp needs (mock quote)</span><span>{formatUsdc(quote.usdcRequired)}</span></div>
              <div className="kv small"><span>Cloak withdraw fee</span><span>{formatUsdc(required - quote.usdcRequired)}</span></div>
              <div className="kv"><span>Shielded USDC needed</span><strong>{formatUsdc(required)}</strong></div>
              <p className="warn small">No licensed off-ramp is integrated yet: the quote is simulated and paying it is disabled.</p>
            </>
          )}
        </section>
      )}

      <section>
        <h2>1 · Wallet</h2>
        {wallet ? (
          <p>{wallet.name} connected: <code>{wallet.address}</code></p>
        ) : (
          <button onClick={() => void connect()} disabled={!!busy || !findWallet()}>
            {findWallet() ? "Connect wallet" : "No Solana wallet detected"}
          </button>
        )}
      </section>

      {wallet && !funding && (
        <section>
          <h2>2 · Unlock shielded balance</h2>
          <label>
            Solana mainnet RPC URL
            <input value={rpcUrl} onChange={(e) => setRpcUrl(e.target.value)} placeholder="https://…" />
          </label>
          <p className="small muted">
            Your wallet signs a fixed message. Its signature derives your Cloak key and encrypts your notes on this device.
            It is not a transaction and is never uploaded.
          </p>
          <button onClick={() => void unlock()} disabled={!!busy}>Sign to unlock</button>
        </section>
      )}

      {funding && balance && (
        <>
          <section>
            <h2>Shielded balance</h2>
            <div className="kv"><span>USDC in Cloak pool</span><strong>{formatUsdc(balance.total)}</strong></div>
            <p className="small muted">{balance.notes} note(s) stored encrypted in this browser{balance.pending ? ` · ${balance.pending} pending` : ""}</p>
            {required !== null && (
              <p className={balance.total >= required ? "ok small" : "warn small"}>
                {balance.total >= required ? "Enough shielded funds for this purchase." : `Shield at least ${formatUsdc(required - balance.total)} more for this purchase.`}
              </p>
            )}
            <button className="secondary" onClick={() => void reconcile()} disabled={!!busy}>Check notes on-chain</button>
          </section>

          <section>
            <h2>3 · Shield USDC</h2>
            <label>
              Amount (USDC, minimum {formatUsdc(USDC_MIN_DEPOSIT)})
              <input value={shieldInput} onChange={(e) => setShieldInput(e.target.value)} inputMode="decimal" />
            </label>
            <p className="small muted">{PRIVACY_COPY.tip}</p>
            <button onClick={() => void shield()} disabled={!!busy}>Shield on mainnet</button>
          </section>
        </>
      )}

      {busy && <p className="status">{busy}</p>}
      {error && <p className="status warn">{error}</p>}
      {lastTx && (
        <p className="status ok">
          Confirmed and notes saved · <a href={lastTx.explorer} target="_blank" rel="noreferrer">{lastTx.signature.slice(0, 16)}…</a>
        </p>
      )}

      <section className="explain">
        <h2>What this protects</h2>
        <p>{PRIVACY_COPY.whatIsHidden}</p>
        <p>{PRIVACY_COPY.whatIsNotHidden}</p>
      </section>
    </main>
  );
}
