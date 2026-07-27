# Maintaining CCapture

Notes for whoever ships the next release (probably future you).

## Branch & tag layout

| Ref | What it is |
|---|---|
| `master` | The current major, **v2** (the 2026 rewrite). Default branch; maps to npm `latest`. |
| `1.x` | The legacy **1.x** line (pre-rewrite code, as of `v1.1.0`). Kept for patches. |
| tags `v2.x.y` | v2 releases. |
| tags `v1.x.y` | Old 1.x releases (still on npm; pinned users rely on them). |

`1.x` exists so the old line can still receive fixes after v2 shipped. A tag alone
couldn't — you can't commit onto a tag; you can onto a branch.

## Releasing a v2.x update

1. Branch from `master`, open a PR, let CI go green, merge.
2. Bump `version` in `package.json` (semver: patch/minor/major).
3. `npm publish` — runs `prepublishOnly` (the UMD build) and sets the `latest`
   dist-tag automatically. Verify with `npm view ccapture.js version`.
4. Cut a GitHub Release `vX.Y.Z` targeting `master` (creates the git tag + notes).

## Releasing a 1.x patch — read this first

The old line lives on the `1.x` branch. To ship a fix **without** dragging v2
users backwards:

1. `git switch 1.x`
2. Make the fix, bump to the next `1.x.y`, commit, tag `v1.x.y`.
3. Publish with a **non-`latest`** dist-tag so `latest` keeps pointing at v2:
   ```bash
   npm publish --tag v1
   ```
   ⚠️ A plain `npm publish` would move `latest` onto the **old** version (npm tags
   whatever you publish as `latest` unless you say otherwise). Always pass `--tag`
   for maintenance releases of an older line.
4. Consumers stay on the old line with `npm i ccapture.js@1`.

## CDN

- unpkg / jsdelivr serve the npm tarball, e.g.
  `https://cdn.jsdelivr.net/npm/ccapture.js@2/build/ccapture.umd.min.js`.
- `build/` is gitignored and produced by `prepublishOnly`; it ships in the npm
  tarball via the `files` field in `package.json` (not from git).
- ⚠️ Unversioned embeds of the **old** bundle path
  (`unpkg.com/ccapture.js/build/CCapture.all.min.js`) 404 on v2 — that file was
  removed. Point people at `@1` for the old build, or the v2 UMD path above.

## Local checks (mirror of CI)

```bash
npm test            # Node unit suites
npm run test:types  # tsc over the .d.ts declarations
npm run build       # UMD bundle
npm run test:browser # headless Chromium — needs the browser installed once:
                     #   npx playwright-core install --with-deps chromium
```

Line endings are pinned to LF via `.gitattributes`; if you ever see every file
show as "changed" with no real edits, that's a CRLF conversion — discard it,
don't commit it.
