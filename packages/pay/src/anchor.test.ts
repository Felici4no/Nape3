import { describe, expect, it } from "vitest";
import { anchorMemo, parseAnchorMemo } from "./anchor";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("transparency anchor memo", () => {
  it("round-trips through the memo program's log line", () => {
    const memo = anchorMemo({ methodologySha256: A, engineSha256: B, commit: "504f5c1" });
    expect(memo.length).toBeLessThan(566);
    const log = `Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr invoke [1]\nProgram log: Memo (len ${memo.length}): "${memo}"`;
    expect(parseAnchorMemo(log)).toEqual({ methodologySha256: A, engineSha256: B, commit: "504f5c1" });
  });

  it("refuses anything that is not a SHA-256", () => {
    expect(() => anchorMemo({ methodologySha256: "x", engineSha256: B, commit: null })).toThrow();
    expect(parseAnchorMemo("hello")).toBeNull();
  });
});
