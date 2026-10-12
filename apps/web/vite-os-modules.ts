import { createHash } from "crypto";
import { readFileSync } from "fs";
import type { Plugin } from "vite";

/**
 * OS modules plugin: tracks each module chunk and the shell hash for in-place module swaps.
 * Emits os-modules.json with module metadata and integrity info (spec §2a step 1).
 */
export function osModulesPlugin(): Plugin {
  return {
    name: "vite-os-modules",
    apply: "build",
    generateBundle(_, bundle) {
      const modules: Record<string, { file: string; imports: string[]; hash: string }> = {};
      const shellModules: Record<string, string> = {};

      // First pass: identify module chunks and other chunks
      const moduleChunks: Record<string, { file: string; imports: string[]; moduleId: string }> = {};

      for (const [filename, asset] of Object.entries(bundle)) {
        if (asset.type !== "asset" && "facadeModuleId" in asset && asset.facadeModuleId) {
          const match = asset.facadeModuleId.match(/src\/modules\/([^/]+)\/index\.tsx$/);
          if (match) {
            const moduleId = match[1];
            const imports = asset.imports ?? [];
            moduleChunks[filename] = { file: filename, imports, moduleId };
          }
        }
      }

      // Calculate hashes for module chunks
      for (const [filename, chunk] of Object.entries(moduleChunks)) {
        const moduleFiles: string[] = [];
        if ("modules" in bundle[filename]) {
          const chunkModules = (bundle[filename] as any).modules ?? {};
          moduleFiles.push(
            ...Object.keys(chunkModules)
              .filter(id => !id.startsWith("\0") && !id.includes("?"))
              .sort()
          );
        }

        // Compute hash from sorted source contents
        let contentToHash = "";
        for (const modulePath of moduleFiles) {
          try {
            const realPath = modulePath.startsWith("file://") ? modulePath : modulePath;
            const content = readFileSync(realPath, "utf-8");
            contentToHash += content;
          } catch {
            // Ignore missing files during hash computation
          }
        }

        const hash = createHash("sha256")
          .update(contentToHash || chunk.file)
          .digest("hex");

        modules[chunk.moduleId] = {
          file: chunk.file,
          imports: chunk.imports,
          hash,
        };
      }

      // Compute shell hash from all non-module chunks
      let shellContent = "";
      for (const [filename, asset] of Object.entries(bundle)) {
        if (asset.type !== "asset" && !moduleChunks[filename]) {
          if ("modules" in asset) {
            const chunkModules = (asset as any).modules ?? {};
            for (const modulePath of Object.keys(chunkModules)
              .filter(id => !id.startsWith("\0") && !id.includes("?"))
              .sort()) {
              try {
                const realPath = modulePath.startsWith("file://") ? modulePath : modulePath;
                const content = readFileSync(realPath, "utf-8");
                shellContent += content;
              } catch {
                // Ignore missing files
              }
            }
          }
        }
        shellModules[filename] = filename;
      }

      const shellHash = createHash("sha256").update(shellContent || "shell").digest("hex");

      // Emit os-modules.json
      // Every chunk this build has: a swapped module may only import files the running page already has.
      const files = Object.values(bundle).filter(a => a.type === "chunk").map(a => a.fileName).sort();
      const osModulesData = {
        shell: shellHash,
        files,
        modules,
      };

      this.emitFile({
        type: "asset",
        fileName: "os-modules.json",
        source: JSON.stringify(osModulesData),
      });
    },
  };
}
