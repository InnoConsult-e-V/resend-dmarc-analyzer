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
│   ├── api/
│   │   ├── analyze/route.ts          # POST endpoint for frontend parsing
│   │   └── webhooks/dmarc/
│   │       ├── rua/route.ts          # Aggregate report webhook
│   │       └── ruf/route.ts          # Forensic report webhook (pass-through)
│   ├── page.tsx                      # Paste-and-analyze frontend
│   ├── layout.tsx                    # App layout
│   └── globals.css                   # Resend-style dark theme
├── components/dmarc/
│   ├── summary-card.tsx              # Stats card component
│   ├── status-badge.tsx              # Pass/fail badges
│   ├── records-table.tsx             # Records table with auth results
│   └── report-viewer.tsx             # Main report display component
├── emails/
│   └── dmarc-report.tsx              # React Email template
├── lib/
│   ├── config.ts                     # Environment config
│   ├── dmarc/
│   │   ├── parser.ts                 # XML parser & analysis
│   │   ├── attachments.ts            # .xml, .gz, .zip extraction
│   │   └── sample.ts                 # Sample XML for testing
│   ├── email/
│   │   └── send-report.ts            # Email sender (disabled)
│   └── webhook/
│       └── verify.ts                 # Svix signature verification
├── types/
│   └── dmarc.ts                      # TypeScript types
└── .env.example                      # Environment variables template
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
| `DMARC_MAILBOX_FOLDER` | Optional folder (default `inbox`) |
| `DMARC_CACHE_DIR` | Optional cache folder (default `.cache/dmarc`) |
| `DMARC_CACHE_TTL_HOURS` | Optional cache lifetime (default `168`) |

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
| 0 reports found | Attachment names must end in `.xml`, `.gz` or `.zip`, and only the 50 most recent messages with attachments are checked. |

### Caching

Parsed reports are cached on disk (one JSON file per attachment, under `.cache/dmarc`, git-ignored), so repeat fetches only download and parse new messages. **Force refresh** in the UI bypasses the cache. The cache holds report data (domains, source IPs) in plain text with `0600` file permissions. Delete the folder to clear it.

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
