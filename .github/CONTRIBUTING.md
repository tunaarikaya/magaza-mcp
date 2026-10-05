# Contributing guide

We keep it short. Do the following and you're good.

## Setup

```bash
git clone https://github.com/tunaarikaya/magaza-mcp.git
cd magaza-mcp
npm install
npm run build
npm run kontrol
```

- `npm run build` — compiles TypeScript and copies the catalog JSON files into `dist/`.
- `npm run kontrol` — `tsc --noEmit`, i.e. type-checking. Must pass clean before sending a PR.
- `npm run dev` — runs the compiler in watch mode.

Node 18+ is supported (`package.json` → `engines`); Node 20 or 22 is
recommended for development — CI runs on both (`.github/workflows/ci.yml`).

## When adding a tool

New tools go under `src/araclar/`. Follow the existing convention there:

- **Descriptions are in Turkish.** Tool description, parameter description,
  error message — every string the user or the model sees is in Turkish.
  This is intentional: the product itself is a Turkish-first MCP server, and
  tool-facing text follows that.
- **Field names are in Turkish.** Parameter and return fields use Turkish
  names like `magaza`, `onayla`, `govde`; don't mix in English.
- **Comments are in Turkish.** The block comment at the top of the file
  should explain what the tool does.
- **Tools that modify data require approval.** A write tool must not perform
  the action without `onayla=true`; it should first describe what it would do.
- **Don't forget read-only mode.** Write tools are flagged with
  `yazma: true`; these are removed from the list when `--salt-okunur` is on.
  The one exception is `magaza__cagir`: it's the single gateway for both read
  and write endpoints, so it stays in the list and enforces the write
  protection itself, per operation.

## Catalogs are never hand-edited

`src/katalog/appstore.json` and `src/katalog/play.json` are generated files.
Don't edit them by hand. After updating the Apple/Google definitions under
`spec/`, run:

```bash
node scripts/uret-katalog.mjs
```

Changing the generator script itself (`scripts/uret-katalog.mjs`) is fine —
hand-patching its output is not.

The files under `spec/` are also never updated by hand. To pull fresh
versions from Apple and Google and regenerate the catalogs:

```bash
npm run spec:guncelle
```

You usually don't need to do this manually: `.github/workflows/spec-guncelle.yml`
runs the same job every Monday and opens an automatic PR if anything changed.

## Before sending a PR

- [ ] `npm run kontrol` passes clean.
- [ ] `npm run build` completes without errors.
- [ ] The change contains **no real credentials**: Key ID, Issuer ID, `.p8`
      contents, service account JSON, access tokens, real email addresses,
      or real package/app names. Examples should be entirely made up.
- [ ] No absolute paths specific to your local machine (like `/Users/...`)
      leaked into code or docs.
- [ ] New user-facing strings are in Turkish.

If unsure, read through the `git diff` output once — that's the fastest check.

## Cutting a release

Publishing is never done by hand; `npm publish` is run by GitHub Actions. The
reason is provenance: npm generates a Sigstore-signed provenance attestation
while building the package inside Actions, shown as "Provenance" on the npm
page — proof, which can't be faked by hand, that the tarball was really built
from this commit in this repo. Publishing from your own machine skips that
seal.

```bash
npm version minor -m "Sürüm %s"   # package.json + tag
git push origin main --follow-tags
```

Once the tag is pushed, the `Yayınla` workflow runs: it verifies the version
matches the tag, runs type-check + build + tests, then publishes with
`npm publish --provenance`.

### First-time setup: trusted publishing

The repo **has no** publish token, and shouldn't. npm recognizes this repo and
the `yayinla.yml` workflow as a trusted publisher; GitHub issues a
short-lived, signed OIDC identity on every run, and npm verifies it. Since
there's no long-lived secret stored, there's nothing to be stolen, expire, or
leak by accident. The provenance attestation comes from the same mechanism.

One-time setup on the npm side:

**Packages → magaza-mcp → Settings → Trusted Publisher → GitHub Actions**

| Field | Value |
|---|---|
| Organization or user | `tunaarikaya` |
| Repository | `magaza-mcp` |
| Workflow filename | `yayinla.yml` |
| Environment | empty |

If the workflow filename changes, this entry needs to change too, otherwise
publishing fails with `ENEEDAUTH`.

> npm's "Generate New Token → Bypass 2FA" path also works, but npm itself
> doesn't recommend it for CI: that token is long-lived and carries publish
> rights, so a leak lets someone else publish the package. Trusted publishing
> has no such secret.

## Bugs and suggestions

Use the issue forms for bug reports and feature requests. Security
vulnerabilities don't go in an issue — see [SECURITY.md](SECURITY.md).
