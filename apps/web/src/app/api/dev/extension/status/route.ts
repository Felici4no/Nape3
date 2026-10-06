import { bridgeConfig } from "@/lib/dev-bridge";
import { json } from "@/lib/dev-bridge-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Why the bridge is on or off: booleans and a length bucket only, never a value. */
export async function GET() {
  return json(bridgeConfig(process.env));
}
