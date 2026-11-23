# DMARC Analyzer

A Next.js application to analyze DMARC aggregate reports (RUA) and forensic reports (RUF). Reads reports directly from an Exchange Online mailbox via Microsoft Graph (on demand, from the UI) and also supports manual paste-and-analyze.

## Features

- Parse DMARC aggregate reports (RUA) from XML
- Handle compressed attachments (.xml.gz, .zip)
- "Fetch from mailbox" button that reads recent `.xml.gz` reports from an Exchange Online mailbox (Microsoft Graph)
- React Email template for report digests
- Web interface for paste-and-analyze

## Project Structure

```
src/
├── app/
│   ├── page.tsx                      # Dashboard (home): sync, changes, domains, trends
│   ├── domains/[domain]/page.tsx     # Domain page: readiness, trends, DNS, sources
│   ├── reports/page.tsx              # Report viewer and paste-XML analyzer
│   ├── api/
│   │   ├── overview/                 # Last sync/review, changes, per-domain readiness
│   │   ├── review/                   # "Mark as reviewed"
│   │   ├── dashboard/                # Aggregates; enrich (reverse DNS); dns (record check)
│   │   ├── reports/                  # fetch (mailbox sync), cached
│   │   ├── auth/                     # Microsoft sign-in (login, callback, status, logout)
│   │   ├── health/                   # Status pill check
│   │   └── analyze/                  # Parse pasted XML
│   └── layout.tsx, globals.css       # Layout and dark theme
├── components/
│   ├── dashboard/                    # Cards, chart, tables, readiness and DNS panels
│   ├── dmarc/                        # Per-report viewer components
│   ├── app-header.tsx, mailbox-controls.tsx, status-banner.tsx, status-pill.tsx
├── hooks/                            # use-health, use-mailbox
├── lib/
│   ├── config.ts                     # Environment configuration
│   ├── graph/                        # Microsoft Graph: auth, token store, mailbox listing
│   ├── cache/report-cache.ts         # On-disk cache of parsed reports
│   ├── state/store.ts                # Last sync / last review times
│   ├── dashboard/                    # aggregate, readiness, changes, overview (pure logic)
│   ├── dns/                          # records (DMARC/SPF/DKIM check), spf (lookup counter), history, reverse (PTR)
│   ├── data/store.ts                 # JSON store for your own data (.data/)
│   ├── dmarc/                        # parser, attachments, identity matching
│   ├── format-date.ts                # DD.MM.YYYY formatting
│   └── email/send-report.ts          # Email sender (disabled)
├── emails/dmarc-report.tsx           # React Email digest template (preview only)
├── proxy.ts                          # Local-only guard (rejects non-local requests)
└── types/dmarc.ts                    # TypeScript types
.env.example                          # Environment variables template
```

## Getting Started

1. Install dependencies:

```bash
pnpm install
```

2. Copy the environment template and fill it in (see [Microsoft Entra / Exchange Online setup](#microsoft-entra--exchange-online-setup)):

```bash
cp .env.example .env.local
```

3. Run the development server:

```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) to use the analyzer.

## Local only

This app reads a real mailbox and is meant to run **only on your own machine**. Do not deploy it or expose it through a tunnel or reverse proxy.

- `pnpm dev` and `pnpm start` bind to `127.0.0.1` only.
- `src/proxy.ts` rejects (403) any request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]`, any request whose `X-Forwarded-For`, `X-Forwarded-Host` or `X-Real-IP` points at a non-local address (as a reverse proxy or tunnel such as ngrok would add), any `Forwarded` header, and cross-site or non-local-origin requests to `/api/*`.
- Do not start Next with `-H 0.0.0.0`. The proxy check is defense in depth, and binding to loopback is the primary control.
- `pnpm email` (the React Email template preview) has no host option and may listen on all interfaces. Run it only on a trusted network, or skip it.

## Environment Variables

Secrets are read only from environment variables (never hard-coded). Put them in `.env.local` (git-ignored). See `.env.example`.

| Variable | Description |
|----------|-------------|
| `AZURE_TENANT_ID` | Entra tenant ID |
| `AZURE_CLIENT_ID` | App registration (client) ID |
| `DMARC_MAILBOX` | The (shared) mailbox that receives the reports |
| `AUTH_REDIRECT_URI` | Optional, default `http://localhost:3000/api/auth/callback` |
| `DMARC_AUTH_DIR` | Optional folder for the sign-in token (default `.cache/auth`) |
| `DMARC_FETCH_DAYS` | Optional, how many days back a fetch looks (default `90`) |
| `DMARC_MAILBOX_FOLDER` | Optional folder (default `inbox`) |
| `DMARC_CACHE_DIR` | Optional cache folder (default `.cache/dmarc`) |
| `DMARC_CACHE_TTL_HOURS` | Optional cache lifetime (default `2160`, i.e. 90 days) |
| `DMARC_CACHE_MAX_ENTRIES` | Optional cache size cap (default `5000`) |
| `DMARC_REPORT_ADDRESS` | Optional address that receives the reports; the DNS check verifies `rua=` includes it |
| `DMARC_DATA_DIR` | Optional folder for your own data such as the DNS history (default `.data`, git-ignored) |
| `DMARC_STATE_DIR` | Optional folder for the last-sync and last-review times (default `.cache/state`) |
| `DMARC_DNS_CACHE_DIR` | Optional folder for cached reverse-DNS lookups (default `.cache/dns`) |

## Microsoft Entra / Exchange Online setup

The app signs in with **delegated** permissions (authorization code + PKCE). It can only read mailboxes that the signed-in person can open, and there is **no client secret** to create or store. Everything below is done in the browser; no PowerShell is needed.

**You need:** permission to register apps in Microsoft Entra, access to the Exchange admin center (or an admin who can do step 3), and a person (the "signing-in user") who will be granted access to the DMARC mailbox.

### 1. Register the app

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → *Identity → Applications → App registrations → New registration*.
2. Name it (e.g. "DMARC Analyzer") and choose **Accounts in this organizational directory only**.
3. Under *Redirect URI*, select the platform **Public client/native (mobile & desktop)** and enter `http://localhost:3000/api/auth/callback`. (If the form doesn't offer it, add it afterwards under *Authentication → Add a platform → Mobile and desktop applications*.)
4. Click **Register**, then copy two values from the Overview page: the **Directory (tenant) ID** and the **Application (client) ID**.

You do **not** need *Certificates & secrets*.

### 2. Add API permissions

1. Open *API permissions → Add a permission → Microsoft Graph → Delegated permissions*.
2. Select `Mail.Read` and `Mail.Read.Shared`.
3. Under *OpenID permissions*, select `openid`, `profile` and `offline_access` (`User.Read` is already present).
4. Click **Add permissions**.
5. If your tenant doesn't let users consent for themselves, click **Grant admin consent for <tenant>** (or ask an admin). You will see a "Need admin approval" screen at sign-in if this is required.

### 3. Give the signing-in user access to the mailbox

This grant is what limits the app to the DMARC mailbox.

1. Go to the [Exchange admin center](https://admin.exchange.microsoft.com) → *Recipients → Mailboxes* and select the DMARC (shared) mailbox.
2. Open **Delegation** ("Manage mailbox delegation").
3. Under **Read and manage (full access)**, click *Edit* and add the person who will sign in to the app.
4. Allow up to about an hour for the change to take effect.

### 4. Find the mailbox identifier

`DMARC_MAILBOX` is passed to Graph as `/users/{id}`, so use the mailbox's **user principal name (UPN)** or its **object ID**. A shared mailbox's UPN is often different from its email address (for example `name@yourtenant.onmicrosoft.com`).

1. In the Entra admin center go to *Identity → Users → All users* and find the shared mailbox (it appears as a user with sign-in blocked).
2. Copy its **User principal name** or **Object ID**.

### 5. Configure and run

1. Put the values in `.env.local` (git-ignored):

   ```
   AZURE_TENANT_ID=<directory (tenant) id>
   AZURE_CLIENT_ID=<application (client) id>
   DMARC_MAILBOX=<mailbox UPN or object id>
   ```

2. Run `pnpm dev` (the app must run on port 3000 to match the redirect URI) and open <http://localhost:3000>.
3. Click **Sign in with Microsoft** and sign in as the person you delegated in step 3.
4. Click **Fetch from mailbox**. Attachments in `.xml.gz` (also `.xml`, `.gz`, `.zip`) are decompressed and parsed.

The sign-in refresh token is stored in plain text in `.cache/auth/token.json` (`0600`, git-ignored). **Sign out** in the UI deletes it, and access can be revoked in Entra. Tokens eventually expire (or earlier if your tenant's sign-in policies require it), and the UI then asks you to sign in again.

### Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `AADSTS50011` (redirect URI mismatch) | The redirect URI in Entra must exactly match `http://localhost:3000/api/auth/callback` and use the *Mobile and desktop applications* platform. The app must run on port 3000 (or set `AUTH_REDIRECT_URI` to match). |
| "Need admin approval" / `AADSTS65001` | Click **Grant admin consent** in *API permissions*, or ask an admin. |
| `AADSTS7000218` (client secret required) | In *Authentication*, set **Allow public client flows** to **Yes**. |
| Fetch fails with `HTTP 404, ErrorInvalidUser` | Graph can't resolve `DMARC_MAILBOX`. Check for typos and use the UPN or object ID (step 4). The mailbox must be in this tenant and in Exchange Online. |
| Fetch fails with `HTTP 404, ErrorItemNotFound` | The folder doesn't exist. Remove `DMARC_MAILBOX_FOLDER` (default is `inbox`) or fix its name. |
| Fetch fails with `HTTP 403` | The signing-in user doesn't have *Read and manage* on the mailbox yet (step 3), it hasn't propagated, or you signed in as a different account. |
| "Sign in required" after working earlier | The sign-in expired or was revoked. Click **Sign in with Microsoft** again. |
| `Missing configuration: …` | A variable is missing from `.env.local`. Restart `pnpm dev` after editing it. |
| 0 reports found | Attachment names must end in `.xml`, `.gz` or `.zip`, and only messages from the last 90 days (`DMARC_FETCH_DAYS`) are checked. |

### Using the app

The **dashboard** (the home page) is built for an occasional check-in by one admin:

1. **Sync mailbox** at the top downloads new reports (manual; the app never syncs on its own). It shows when the data was last synced and warns if that is more than 7 days ago.
2. **Since you last reviewed** lists what is new since you last pressed **Mark as reviewed**: new reports, a change in the pass rate, new or newly failing sending sources, and policy changes. New means *received* after the review, so late-delivered reports about older days count too. Pressing the button sets the new baseline (stored locally, see `DMARC_STATE_DIR`; deleting `.cache` resets it).
3. **Domains** shows one card per domain with its published policy, a **readiness** status, the single recommended next step and the key numbers. Click a card for the **domain page**: the full readiness checklist, trend chart, live DNS check and every sending source.
4. **Reports** (in the header) is the report-by-report viewer and the paste-XML analyzer.

#### Policy readiness

Each domain is assessed over the last 30 days. If that holds fewer than 100 messages (a small domain), the window widens to 60 and then 90 days; the window used is shown. The status answers "can I move to a stricter policy?":

| Status | Meaning |
|---|---|
| Not enough data | Fewer than 14 report days or 100 messages even on the widest window. Keep syncing. |
| Not ready | A check failed (for example too many messages failing both DKIM and SPF, or a missing DMARC record). |
| Almost ready | Only warnings are left (for example `pct` below 100, a stale sync, or the policy not yet stable). |
| Ready to tighten | All checks pass: the next step says to move to `p=quarantine` (start with `pct=25`) or to `p=reject`. |
| Enforced | `p=reject` with a failure rate within the limit. |
| Enforced, needs review | `p=reject`, but more messages fail both checks than the limit: legitimate mail may be rejected. |

The thresholds are constants in `src/lib/dashboard/readiness.ts`: at most **2%** of messages failing both checks to move from `none` to `quarantine`; at most **0.5%** to move to `reject` (and to stay healthy there), with `quarantine` stable for at least **14 days**. Senders failing both checks are listed for review: only you can tell whether a failing sender is yours (fix its SPF or DKIM first) or a spoofer (which enforcement blocks).

The readiness metric, **survives enforcement**, counts every message that passed at least one of DKIM or SPF, because that is what DMARC requires. The stricter **passed both** figure (both aligned checks passed) is shown separately; the two are labelled so they are not confused.

#### DMARCbis (the 2026 revision of DMARC)

DMARC was revised in May 2026 (RFC 9989, 9990, 9991). The app reads both the original and the new aggregate report format:

- `pct` is gone in the new format. When a report has no `pct` the policy is treated as applying to all failing mail, and the app never shows `NaN` or `undefined`. Optional tags (`sp`, `adkim`, `aspf`) are shown as "same as p" or "relaxed (default)" when absent.
- `t=y` (testing) means receivers do **not** apply the policy, like the old `pct=0`. Readiness treats `p=quarantine` with `t=y` as *not enforced* and tells you to remove `t=y` once the checks pass.
- New tags `np`, `testing`, `discovery_method`, `version` and `generator` are read and shown where useful. The DNS check explains `pct`, `rf` and `ri` as deprecated, understands `t`, `np` and `psd`, and suggests `np=reject` for enforced policies.

#### DNS health

The domain page checks the live DNS records and keeps a history:

- **SPF lookups:** SPF allows at most **10 DNS lookups** (counting nested `include`, `a`, `mx`, `ptr`, `exists`, `redirect`) and 2 "void" lookups that return nothing. Going over makes SPF fail with a PermError, silently, and the only sign is DMARC failures in reports. The panel shows a meter (`3 of 10`) and the include tree, warns from 8, and errors above 10. The walk is capped in depth, number of queries and time. The app never flattens SPF for you.
- **DKIM keys:** the key type and size of each selector seen in your reports. RSA under 1024 bits is an error, 1024 bits a warning (upgrade to 2048 when you next rotate), 2048 and Ed25519 are fine. Revoked or missing selectors are flagged.
- **Change history:** after every mailbox sync, and on every check, the app records a snapshot of your DMARC, SPF and DKIM records. Only changes are stored (the first check is the baseline), such as `DMARC: p changed from none to quarantine`, `SPF: added include:x.com`, or `DKIM key for selector s1 changed (rotated)`. It also notices when an *included* SPF record changes underneath an unchanged record (the lookup count moves). A failed DNS lookup is never recorded as a change. DNS changes after your last review appear in "Since you last reviewed".

The history lives in `.data/dns-history.json`. `.data/` (see `DMARC_DATA_DIR`) holds your own data that cannot be re-created and is git-ignored; `.cache/` can be deleted freely.

#### Dashboard details

- **Trends range:** date range (7/30/90 days or all time, relative to now) for the chart and totals.
- **Metrics:** each message is counted as *passed both* (aligned DKIM and SPF passed), *passed one*, or *failed both*. The headline rate is *passed both / messages*, the same definition as the per-report card. Counts are weighted by each record's message count. Repeated reports are de-duplicated by reporter and report ID. Days are UTC days of the report's start time.
- **Daily chart:** stacked columns of the three outcomes, with a table view and keyboard support (arrow keys read each day).
- **Sending sources:** each source IP is shown with its reverse-DNS name, confirmed by a forward lookup. Sources are marked *Healthy* (at least 95% passed both), *Failing* (at least 50% failed both), otherwise *Mixed*. A failing source with at least 10 messages and no confirmed reverse DNS is flagged *Suspicious*.
- **DNS check** (per domain, on demand): looks up the live DMARC, SPF and DKIM records (for the selectors seen in your reports) and reports problems such as a missing record, `p=none`, `pct<100`, no `rua=`, multiple SPF records, a permissive `all`, or revoked DKIM keys. If `DMARC_REPORT_ADDRESS` is set, it also checks that `rua=` includes it.

**What a report tells you about senders:** an aggregate (RUA) report identifies the *reporter* (organisation, contact address, report ID) and, per group of messages, the *sending server* (source IP), the visible *From domain*, the *DKIM signing domain and selector*, the *SPF domain* (and whether SPF checked the MAIL FROM or HELO name) and, if the reporter includes it, the *envelope-from* domain. It never contains individual sender addresses, subjects, message IDs or content; that only appears in forensic (RUF) reports, which this app does not read. The dashboard's **Sends as** column and the per-report **Authenticated as** column show these identities and mark (with ↗) any domain that is not one of the reported domains, which usually means a third-party sender (for example a mailing service signing with its own domain) and occasionally spoofing. Envelope-from and SPF scope are captured from now on; reports cached before that need one **Force refresh** to include them.

Privacy: reverse and DNS lookups go only to your machine's own DNS resolver. No third-party IP, geo or reputation services are used. Only domains and IPs that appear in your cached reports can be looked up. Lookup results are cached in `.cache/dns`.

### Caching

Parsed reports are cached on disk (one JSON file per attachment, under `.cache/dmarc`, git-ignored), so repeat fetches only download and parse new messages. **Force refresh** in the UI bypasses the cache. Entries are kept for 90 days by default so the dashboard can show trends, which means report data stays on disk in plain text for that long; lower `DMARC_CACHE_TTL_HOURS` if that is too long. The cache holds report data (domains, source IPs) in plain text with `0600` file permissions. Delete the folder to clear it.

Email digest sending is currently disabled. The template in `src/emails/dmarc-report.tsx` is kept so a transport can be added later.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start development server |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint:fix` | Run linter with auto-fix |
| `pnpm email` | Preview email templates (port 3003) |
| `pnpm test:email [file]` | Render the digest template with sample data to an HTML file |

## Tech Stack

- [Next.js 16](https://nextjs.org/) - React framework
- [React 19](https://react.dev/) - UI library
- [Tailwind CSS 4](https://tailwindcss.com/) - Styling
- [Microsoft Graph](https://learn.microsoft.com/graph/) - Mailbox access
- [React Email](https://react.email/) - Email templates
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) - XML parsing
