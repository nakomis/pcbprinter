# pcbprinter

Converts Fritzing PCB SVG exports to 3D-printable STL files. Works as both a CLI tool and an importable library (used by the sandboxsite React app in the browser).

## Versioning

Two files track the version, with distinct roles:

| File | Role |
|------|------|
| `version.json` | Current development state — read by the CLI `--version` flag and the `VERSION` library export. Is a `-SNAPSHOT` between releases. |
| `package.json` `.version` | Last *released* version — used by npm for dependency resolution. Always a clean semver, never `-SNAPSHOT`. |

This split is intentional: sandboxsite references pcbprinter as a `file:` path dep, so `npm install` reads `package.json`. Keeping it at the release version means sandboxsite always installs a release, even while pcbprinter is mid-development on the next SNAPSHOT.

### Releasing

```bash
npm run release          # patch bump (0.2.1 → 0.2.2)
npm run release -- --minor  # minor bump (0.2.1 → 0.3.0)
npm run release -- --major  # major bump (0.2.1 → 1.0.0)
```

The release script:
1. Strips `-SNAPSHOT` from `version.json` → release version
2. Updates `package.json` to the release version
3. Builds (`tsc` + browser bundle)
4. Commits and tags `pcbprinter/x.y.z`
5. Bumps **only `version.json`** to the next `-SNAPSHOT` (`package.json` stays at the release version)
6. Commits and pushes with tags

### After releasing — update sandboxsite

```bash
cd sandboxsite/sandbox-app && npm install
```

This picks up the new release version from `package.json` and records it in `package-lock.json`. The sandboxsite deploy script will refuse to deploy if `node_modules/pcbprinter/package.json` shows a `-SNAPSHOT` version.

## CLI usage

```bash
pcbprinter <input.svg> [options]
pcbprinter --version
pcbprinter --help
```

## Library usage

```typescript
import { parseFritzingSvg, buildStls, VERSION } from 'pcbprinter';
```
