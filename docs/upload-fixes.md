# Upload and frontend security fixes

Reviewed on 25 October 2026, based on `feature/canvas-editor` at `35cdf90`.

## Image uploads

The previous upload used Ky's default 10-second timeout. The canceled request in
the reported screenshot ends at that limit. Folder validation already accepts an
owned folder ID; large photographs on a throttled connection could time out before
the server received the full body.

Uploads now use XMLHttpRequest with a 120-second budget matching the backend,
the same bearer authentication and expired-session behavior, and native byte
progress across browsers. The library shows the current file and batch count,
destination folder, percentage transferred, and a separate saving state while
waiting for the server's response. The destination is captured at the start of a
batch even if the user browses another folder. Overlapping mutations are blocked.

A failed file does not stop the remaining files. The final status reports the
success and failure counts, names each failed file, and refreshes the image list
and folder counts even after partial failure. Upload errors distinguish size
limits, missing folders, connection failures, timeouts and expired sessions.
Uploads are never automatically retried, avoiding duplicate originals when the
server's acknowledgement is lost.

The landing page embeds the app's existing `favicon.ico`, matching the supplied
logo and remaining available without the built frontend directory.

## Dependency review

The initial `pnpm audit` reported 52 advisories (31 high, 18 moderate, 3 low).
Compatible updates reduce the final audit to zero advisories:

| Direct dependency | Previous lockfile version | Updated version |
| --- | --- | --- |
| React Router DOM | 7.13.2 | 7.18.4 |
| Vite | 8.0.3 | 8.3.5 |
| Vite React plugin | 6.0.1 | 6.1.2 |
| ESLint / ESLint JS | 9.39.4 | 9.39.5 |
| React Hooks ESLint plugin | 7.0.1 | 7.1.1 |
| TypeScript ESLint | 8.57.2 | 8.72.0 |

The lockfile also updates compatible transitive versions of Babel, humanfs,
baseline-browser-mapping, brace-expansion, browserslist, js-yaml, nanoid,
PostCSS, source-map-js and Zod. No dependency major versions changed. ESLint
remains on its existing version 9 line; migrating to version 10 is separate work.

The relevant upstream advisories include
[Vite filesystem exposure](https://github.com/vitejs/vite/security/advisories/GHSA-rq7h-c2jc-7f22)
and [React Router external redirects](https://github.com/remix-run/react-router/security/advisories/GHSA-wrjc-x8rr-h8h6).
Some router findings concern server rendering modes this SPA does not use;
updating still removes the vulnerable versions from the dependency graph.

The updated Hooks lint rules found two existing ref writes during canvas render.
These now synchronize in a layout effect before user events, preserving the
canvas event handlers' current values without modifying refs during rendering.

## Reproducible frontend installs

The Docker build initially used an unpinned pnpm version, while the lockfile had
been updated locally with pnpm 10.7.0. The newer container toolchain enforced a
one-day minimum release age and rejected `baseline-browser-mapping@2.11.33`,
published on 25 October at 17:28 UTC. Local verification had missed that policy.

`web/package.json` now pins pnpm 12.15.0. Docker installs that exact version
directly from npm, avoiding differences in bundled Corepack launchers, and copies
`pnpm-workspace.yaml` before the frozen install. The workspace explicitly enables
the 1,440-minute minimum release age in strict mode. See the
[pnpm dependency-resolution settings](https://github.com/pnpm/pnpm/blob/main/pnpm/docs/settings/dependency-resolution.md).

The lockfile was regenerated with the pinned toolchain and policy. It selects
the mature, patched `baseline-browser-mapping@2.11.32`; the frontend audit remains
clear. No package-age exceptions or trusted-lockfile bypasses are configured.
The additional lockfile boot document records the pinned pnpm distribution.

For local frontend development, install the same package manager before running
`pnpm install --frozen-lockfile`:

```sh
npm install --global pnpm@12.15.0
```

## Verification

- Nine frontend tests cover canvas geometry and upload transport, destination,
  authentication, progress, save acknowledgement and failure handling.
- Production build, lint and the security audit pass.
- The frozen install passes with pnpm 12.15.0 and strict release-age verification.
- A fresh `node:22-alpine` Docker frontend-stage build passes the frozen install
  and production build with the same checked-in toolchain and policy.
- All 24 Rust unit/router/rendering tests pass. The PostgreSQL integration test
  remains ignored because no isolated test database is configured.
- Browser verification uses the real library UI against a disposable local mock
  API that delays each upload response by 15 seconds, exceeding the old timeout.
  It covers progress, folder navigation during a batch, partial failure and
  refreshed folder counts. It does not exercise a deployed database or proxy.
