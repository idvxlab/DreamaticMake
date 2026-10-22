import { rename } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

/** Preserve atomic replacement when Windows briefly locks the destination for reading. */
export async function replaceFile(source: string, destination: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt >= 5 ||
        !["EPERM", "EACCES", "EBUSY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        throw error;
      // Never unlink the previous file: readers must see a complete old or new value.
      await setTimeout(20 * 2 ** attempt);
    }
  }
}
