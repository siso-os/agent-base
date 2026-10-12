import { openSync, readSync, closeSync } from "node:fs";

/**
 * Stream a file line by line without holding the whole file in memory.
 * Reads in chunks (default 8 MiB), keeps bytes after the last newline as carry,
 * and decodes only complete lines. UTF-8 characters straddling chunk boundaries
 * are preserved in the carry buffer until the character is complete.
 *
 * @param file - Path to the file to read
 * @param fn - Callback for each line; index is 0-based line number
 * @param chunk - Chunk size in bytes (default 8 MiB); decoding only happens at newline boundaries
 */
export function forEachLine(file: string, fn: (line: string, index: number) => void, chunk = 8 << 20): void {
  const fd = openSync(file, "r");
  try {
    let index = 0;
    let carry = Buffer.alloc(0);
    const buffer = Buffer.alloc(chunk);
    let bytesRead: number;

    while ((bytesRead = readSync(fd, buffer, 0, chunk, null)) > 0) {
      // Combine carry with new bytes
      const data = Buffer.concat([carry, buffer.slice(0, bytesRead)]);

      // Find the last newline (byte 10)
      let lastNewline = -1;
      for (let i = data.length - 1; i >= 0; i--) {
        if (data[i] === 10) {
          lastNewline = i;
          break;
        }
      }

      if (lastNewline >= 0) {
        // Process lines up to and including the last newline
        const text = data.toString("utf8", 0, lastNewline + 1);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length - 1; i++) {
          fn(lines[i], index++);
        }
        // Keep bytes after the last newline as carry
        carry = data.slice(lastNewline + 1);
      } else {
        // No newline found; entire data is potential UTF-8 carry
        carry = data;
      }
    }

    // Process the final carry as the last line if non-empty
    if (carry.length > 0) {
      fn(carry.toString("utf8"), index);
    }
  } finally {
    closeSync(fd);
  }
}
