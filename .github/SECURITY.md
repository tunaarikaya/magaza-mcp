# Security

`magaza-mcp` is a tool that accesses your store accounts. So we keep the
security side explicit upfront.

## Design principles

### Keys stay in the Keychain

The Apple `.p8` private key and the Google service account JSON are stored in
the macOS Keychain. They are **never** written to the config file, an
environment variable, or the repo. The config file only holds which stores
are enabled.

On systems without Keychain access, keys fall back to a local file locked
down to `0600` permissions.

### The server runs locally

The server runs next to your client, on your own machine, over stdio. It
doesn't connect to a server, proxy, or service of ours in between. Your
requests go directly to Apple's and Google's official API endpoints. Nothing
sits in the middle.

### No telemetry

No usage data, error reports, version pings, or "anonymous statistics" of any
kind are collected or sent anywhere.

### Operations that modify data require approval

POST, PATCH, PUT, and DELETE calls don't run on the first attempt. The server
first returns what it would do, the expected request body, and a warning; the
operation only happens once you approve and it's called again with
`onayla=true`.

### Read-only mode turns off writes

The `--salt-okunur` flag (or the `SALT_OKUNUR=1` environment variable)
removes every write-capable tool — `appstore__yorum_yanitla`,
`appstore__metin_guncelle`, and `play__yorum_yanitla` — from the tool list
entirely. The model can't see them, so it can't call them.

The one exception is `magaza__cagir`. It stays in the list, because it's also
the gateway to every **read** endpoint in the catalog; excluding it would
make read-only mode unable to read anything. Write protection on this tool is
enforced per operation: when a data-modifying operation is requested, the
call is rejected with a "server is in read-only mode" error, and the request
body is never sent.

If you want to grant only read access to your production account, this is
the way to do it.

## Reporting a vulnerability

If you find a vulnerability, **don't open a public issue.**

Report it privately through GitHub Security Advisories:

- The repo's **Security** tab → **Report a vulnerability**
- Direct link:
  <https://github.com/tunaarikaya/magaza-mcp/security/advisories/new>

It helps to include:

- What the vulnerability is and what it leads to
- Steps to reproduce it
- The affected version
- A suggested fix, if you have one

**Don't share real credentials in the report.** Don't send a Key ID, Issuer
ID, `.p8` contents, service account JSON, access token, or a real package
name. Use made-up examples if needed.

We try to respond to reports within a reasonable time, and to fix and ship
verified vulnerabilities in a release. Please don't disclose details until a
fix has shipped.

## Supported versions

Security fixes are provided against the latest released version. No
backported patches for older versions.

## If your key has leaked

1. On Apple's side: revoke the key from App Store Connect → Users and Access
   → Integrations, and generate a new one.
2. On Google's side: delete the key from Google Cloud Console → IAM & Admin →
   Service Accounts, and create a new one.
3. Delete local copies and redo the `magaza-mcp` setup with the new key.
