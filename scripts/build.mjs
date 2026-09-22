// Bundles the four entry points with esbuild and copies static assets into dist/.
// `node scripts/build.mjs --watch` rebuilds on change (reload the extension in chrome://extensions).
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

// package.json is the single source of truth for the version; the manifest is generated
// from it so the two cannot drift. BUILD_STAMP additionally distinguishes two builds of
// the SAME version, which is the case that actually bites: after a rebuild, Chrome keeps
// running the old content script until the extension is reloaded, and without a stamp
// there is no way to tell from the page whether a change took effect.
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const BUILD_STAMP = new Date().toISOString().replace(/[-:]/g, "").slice(2, 13); // YYMMDDTHHmm

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

function copyStatic() {
  cpSync("public", outdir, { recursive: true });
  cpSync("src/content/content.css", `${outdir}/content.css`);
  cpSync("src/popup/popup.html", `${outdir}/popup.html`);
  cpSync("src/popup/popup.css", `${outdir}/popup.css`);
  cpSync("src/options/options.html", `${outdir}/options.html`);
  cpSync("src/options/options.css", `${outdir}/options.css`);

  // package.json is the single source of truth for the version; public/manifest.json is a
  // template whose version field is overwritten here so the two cannot drift.
  const manifest = JSON.parse(readFileSync(`${outdir}/manifest.json`, "utf8"));
  manifest.version = pkg.version;
  writeFileSync(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
}

/**
 * Fail loudly if the bundle is incomplete.
 *
 * An edit to copyStatic once dropped every CSS and HTML copy; the build still reported
 * success and Chrome refused the unpacked extension with "Could not load manifest", which
 * points nowhere near the cause. Everything the manifest references is checked here.
 */
function verifyDist() {
  const manifest = JSON.parse(readFileSync(`${outdir}/manifest.json`, "utf8"));
  const required = new Set(["manifest.json"]);
  for (const cs of manifest.content_scripts ?? []) {
    for (const f of [...(cs.js ?? []), ...(cs.css ?? [])]) required.add(f);
  }
  if (manifest.background?.service_worker) required.add(manifest.background.service_worker);
  if (manifest.action?.default_popup) required.add(manifest.action.default_popup);
  if (manifest.options_ui?.page) required.add(manifest.options_ui.page);
  for (const icon of Object.values(manifest.icons ?? {})) required.add(icon);
  // Stylesheets referenced by the extension's own HTML pages.
  for (const page of ["popup.html", "options.html"]) {
    const html = existsSync(`${outdir}/${page}`) ? readFileSync(`${outdir}/${page}`, "utf8") : "";
    for (const m of html.matchAll(/href="([^"]+\.css)"/g)) required.add(m[1]);
  }

  const missing = [...required].filter((f) => !existsSync(`${outdir}/${f}`));
  if (missing.length) {
    console.error(`\nBUILD INCOMPLETE — missing from ${outdir}/:\n  ` + missing.join("\n  ") + "\n");
    process.exit(1);
  }
  return required.size;
}

const common = {
  bundle: true,
  define: { __BUILD_STAMP__: JSON.stringify(BUILD_STAMP) },
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
  const n = verifyDist();
  console.log(`built → dist/  v${pkg.version} build ${BUILD_STAMP}  (${n} required files present)`);
}
