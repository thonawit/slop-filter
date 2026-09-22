// Bundles the four entry points with esbuild and copies static assets into dist/.
// `node scripts/build.mjs --watch` rebuilds on change (reload the extension in chrome://extensions).
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

function copyStatic() {
  cpSync("public", outdir, { recursive: true });
  cpSync("src/content/content.css", `${outdir}/content.css`);
  cpSync("src/popup/popup.html", `${outdir}/popup.html`);
  cpSync("src/popup/popup.css", `${outdir}/popup.css`);
  cpSync("src/options/options.html", `${outdir}/options.html`);
  cpSync("src/options/options.css", `${outdir}/options.css`);
}

const common = {
  bundle: true,
  target: "chrome116",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
  legalComments: "none",
};

const contexts = await Promise.all([
  // Content scripts cannot be ES modules → IIFE.
  esbuild.context({ ...common, entryPoints: ["src/content/content.ts"], outfile: `${outdir}/content.js`, format: "iife" }),
  // MV3 service worker with "type": "module", popup and options are module scripts.
  esbuild.context({
    ...common,
    entryPoints: ["src/background/service-worker.ts", "src/popup/popup.ts", "src/options/options.ts"],
    outdir,
    format: "esm",
    entryNames: "[name]",
  }),
]);

copyStatic();
if (watch) {
  await Promise.all(contexts.map((c) => c.watch()));
  console.log("watching… (static files are copied once; re-run for HTML/CSS/manifest changes)");
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
  console.log("built → dist/");
}
