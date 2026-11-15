# Changelog

## 0.1.1

- 108 tests (controller, webview panel, Vue components, analysis and packages) with minimum coverage enforced on every release.
- No behaviour changes.

## 0.1.0

- First version: finds unused files (views, layouts, components, composables, stores, services, utilities, types, constants and test helpers) and unused npm packages.
- Two separate, optional clean-ups: move files (with their own tests) to the trash, and uninstall packages with the project's package manager. Both can be undone.
- Panel with tabs, search, type filters, groups by module and a sticky action bar for long lists.
- `ballast` CLI that prints the report as text or JSON.
