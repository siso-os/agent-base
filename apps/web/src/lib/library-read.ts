import type { LibraryData } from "../components/LibrarySpace";

/** Each Library view owns its reads. Late answers must not replace a newer catalogue. */
export function libraryReader(onData: (data: LibraryData) => void, onError: (message: string) => void, onLoading?: (loading: boolean) => void) {
  let closed = false;
  let active: AbortController | null = null;
  return {
    // Scheduled reads leave finite slow requests alone. Explicit reads still supersede.
    async read(coalesce = false) {
      if (closed || (coalesce && active)) return;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      onLoading?.(true);
      const current = () => !closed && active === controller && !controller.signal.aborted;
      try {
        const response = await fetch("/api/library", { cache: "no-store", signal: controller.signal });
        if (!current()) return;
        if (!response.ok) throw new Error(String(response.status));
        const data: LibraryData = await response.json();
        if (!current()) return;
        if (!data || !data.counts || !Array.isArray(data.built?.rows) || !Array.isArray(data.live?.rows) || !Array.isArray(data.works?.rows) || !Array.isArray(data.works?.templates) || (data.documents && !Array.isArray(data.documents.rows))) throw new Error("Invalid Library response");
        onData(data);
      } catch (error) {
        if (current()) onError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active === controller) {
          active = null;
          onLoading?.(false);
        }
      }
    },
    close() {
      closed = true;
      active?.abort();
      active = null;
    },
  };
}
