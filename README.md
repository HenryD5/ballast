# Ballast — Unused Files and Packages

*Find the files and npm packages your project no longer uses, and remove them safely.*

Ballast is the weight a ship drops to sail lighter. It reads your project, lists the views, components, composables, stores, services, utilities and npm packages nothing uses any more, and lets you remove them on your terms.

## How it works

1. **Analyze.** Open the Ballast view in the activity bar and choose **Analyze project**. Ballast only reads your code: nothing changes until you decide.
2. **Review.** Results come in two tabs, **Unused files** and **Unused packages**. Files are grouped by module (`src/modules/<name>`, `shared`, `tests`…) and show their folder, their type (view, component, composable…) and why they are unused. Search and type filters help with long lists; groups collapse, and the header and the action bar stay in place while you scroll. Click a file to open it.
3. **Clean up, separately and only if you want.** Files and packages have their own selection and their own button. **Move to trash** sends the chosen files (plus their own tests) to the system trash. **Uninstall** runs `npm uninstall` (or `pnpm remove`, `yarn remove`, `bun remove`) for the chosen packages. Both ask for confirmation, both can be undone from the panel, and afterwards you can run the project's type-check script.

## What counts as unused

Ballast only lists what it can show is safe to remove. When in doubt, it treats the file or package as used and leaves it out.

**Files** (code under `src/`, `app/`, `tests/` and similar folders):

- *Nothing imports it.* No reachable file imports it, lazily loads it or registers it.
- *Only unused files use it.* Every file that imports it is also on the list.
- *Only its tests use it.* The app never reaches it; its own test (`Card.vue` ↔ `Card.spec.ts`) is removed with it. If a test that also checks other code imports it, the file is not listed, because removing it would break that test.

Ballast starts from the real entry points: `index.html`, files named in `vite.config`/`vitest.config` (setup files, Module Federation `exposes`, Rollup inputs), test files, `package.json` fields, and Nuxt/Next route folders. It follows `import`, `export … from`, `require`, dynamic `import()` (lazy routes included), `import.meta.glob`, `vi.mock`, `new URL(…, import.meta.url)`, `tsconfig` paths, Vite aliases, components auto-registered by `unplugin-vue-components` or Nuxt (matched by tag in templates) and auto-imported composables. Commented-out imports do not count. Configuration files, `__mocks__` folders and `.d.ts` files are never listed.

**Packages** (`dependencies` and `devDependencies`):

- *Nothing imports or uses it.* It is not imported, not named in a config file, CSS (`@import`, `@plugin`, `@source "../node_modules/pkg"`), script, Git hook or workflow, not a binary used by a script, not a required peer of a used package, and not tooling that works without imports (`typescript`, `sass`, the Vitest coverage provider…).
- *Only unused files import it.* Remove those files too, or the imports will fail.
- *Node built-in module.* For example the `https` package from npm when the code only uses Node's own `https` in `vite.config`.
- *Types for an unused package.* `@types/x` when `x` is not used.

Without `node_modules`, Ballast cannot see binaries or peers, so it leaves `devDependencies` out and says so.

## Settings

- `ballast.language`: `es` (default) or `en`.
- `ballast.ignore`: globs (`src/legacy/**`) or package names (`left-pad`) that are never reported.

## CLI

```bash
ballast [folder] [--json] [--lang es|en] [--ignore <glob or package>]...
```

The CLI only reads and prints the report; it never deletes or uninstalls anything.

## Safety

- The analysis never runs project code or configuration: it reads files as text.
- Only the paths and packages from the last analysis can be removed, and every request from the panel is validated again.
- Files go to the system trash, never deleted permanently. If the trash is unavailable, nothing is deleted.
- The only commands Ballast runs are `<manager> uninstall|remove <names>`, `<manager> install` (to undo) and `<manager> run <type-check script>`, with arguments checked against a strict list.
- Removing anything requires a trusted workspace.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
```

Press F5 in VS Code to launch an Extension Development Host.

## License

MIT
