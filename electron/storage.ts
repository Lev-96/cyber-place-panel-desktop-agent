import { promises as fs } from "node:fs";

export class FileStore<T> {
  private cached: T | null = null;
  constructor(private filePath: string) {}

  async load(): Promise<T | null> {
    if (this.cached) return this.cached;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.cached = JSON.parse(raw) as T;
      return this.cached;
    } catch {
      return null;
    }
  }

  async save(value: T): Promise<void> {
    this.cached = value;
    await fs.writeFile(this.filePath, JSON.stringify(value), "utf8");
  }
}
