import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoredNote } from "@nape3/payments/cloak";
import { FileNoteStore } from "./file-store";
import { runDemo } from "./main";

describe("cloak CLI", () => {
  it("runs the end-to-end private funding demo (simulated)", async () => {
    const lines: string[] = [];
    const { plan, payout, balance } = await runDemo((line) => lines.push(line));
    expect(plan.funding.kind).toBe("cloak-shielded");
    expect(payout.simulated).toBe(true);
    expect(balance.total).toBeGreaterThan(0n);
    const text = lines.join("\n");
    expect(text).toContain("Your purchase funding is shielded before settlement.");
    expect(text).toContain("Pix is not private");
    expect(text).toContain("SIMULATED");
  });

  it("stores notes with 0600 permissions, atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cloak-"));
    const store = new FileNoteStore(join(dir, "notes.json"));
    const note: StoredNote = { id: "ab", mint: "m", amount: "1", serialized: "x", index: 3, status: "unspent", createdBy: "s", createdAt: "t" };
    await store.save([note]);
    expect(await store.load()).toEqual([note]);
    expect((await stat(join(dir, "notes.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(join(dir, "notes.json"), "utf8")).version).toBe(1);
  });
});
