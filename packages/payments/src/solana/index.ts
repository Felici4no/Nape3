/**
 * Solana preparation — interfaces only. No token, no smart contract.
 * Planned flow: user wallet → USDC (SPL) → off-ramp provider → Pix payout.
 */

export type SolanaCluster = "mainnet-beta" | "devnet";

/** Circle's USDC SPL mint addresses. */
export const USDC_MINT: Record<SolanaCluster, string> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
};

export const USDC_DECIMALS = 6;

/** USDC amounts are bigint base units (1 USDC = 1_000_000). Never floats. */
export type UsdcBaseUnits = bigint;

/**
 * Converts BRL cents to USDC base units at a quoted rate expressed as
 * integer BRL cents per 1 USDC. Rounds up so the payout is never short.
 */
export function brlCentsToUsdcBaseUnits(brlCents: number, rateCentsPerUsdc: number): UsdcBaseUnits {
  if (!Number.isSafeInteger(brlCents) || brlCents < 0) throw new RangeError("brlCents must be a non-negative integer");
  if (!Number.isSafeInteger(rateCentsPerUsdc) || rateCentsPerUsdc <= 0) throw new RangeError("rate must be a positive integer");
  const numerator = BigInt(brlCents) * 1_000_000n;
  const rate = BigInt(rateCentsPerUsdc);
  return (numerator + rate - 1n) / rate;
}

/** User-facing pt-BR display: "25,00 USDC", "5,665144 USDC" (exact, zeros trimmed to 2 decimals). */
export function formatUsdcDisplay(units: UsdcBaseUnits): string {
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0{1,4}$/, "");
  return `${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0")} USDC`;
}

export function formatUsdc(units: UsdcBaseUnits): string {
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction} USDC`;
}

export interface UsdcTransferRequest {
  cluster: SolanaCluster;
  from: string;
  to: string;
  amount: UsdcBaseUnits;
  /** Reference memo linking the transfer to an off-ramp quote. */
  memo: string;
}

export interface WalletAdapter {
  readonly simulated: boolean;
  publicKey(): Promise<string>;
  usdcBalance(cluster: SolanaCluster): Promise<UsdcBaseUnits>;
  /** Must prompt the user in the wallet UI; implementations never auto-sign. */
  signAndSendUsdcTransfer(request: UsdcTransferRequest): Promise<{ signature: string }>;
}

/** In-memory wallet for tests and demos. Moves no real funds. */
export class MockWallet implements WalletAdapter {
  readonly simulated = true;
  constructor(
    private balance: UsdcBaseUnits,
    private readonly key = "MockWa11et1111111111111111111111111111111111"
  ) {}
  async publicKey() {
    return this.key;
  }
  async usdcBalance() {
    return this.balance;
  }
  async signAndSendUsdcTransfer(request: UsdcTransferRequest) {
    if (request.amount > this.balance) throw new Error("insufficient simulated USDC balance");
    this.balance -= request.amount;
    return { signature: `simulated-${request.memo}` };
  }
}
