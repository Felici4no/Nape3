import { chmod, mkdir, open, readFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import type { NoteStore, StoredNote } from "@nape3/payments/cloak";

/**
 * Shielded notes on disk. They contain spend secrets: the directory is 0700,
 * the file 0600, and writes are atomic (temp file + fsync + rename) so a crash
 * can never leave a half-written note file behind.
 */
export class FileNoteStore implements NoteStore {
  constructor(private readonly path: string) {}

  async load(): Promise<StoredNote[]> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as { version: number; notes: StoredNote[] };
      if (parsed.version !== 1 || !Array.isArray(parsed.notes)) throw new Error("unsupported notes file");
      return parsed.notes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(notes: StoredNote[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    const handle = await open(tmp, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ version: 1, notes }, null, 2));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, this.path);
    await chmod(this.path, 0o600);
  }
}
