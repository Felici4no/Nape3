import { Buffer } from "buffer";

// @cloak.dev/sdk's dependencies (and @solana/web3.js) expect Node's Buffer.
// This module is imported first in main.tsx so it runs before any of them.
const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string> } };
g.Buffer ??= Buffer;
g.process ??= { env: {} };
