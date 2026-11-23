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

2. Copy the environment template and fill in your credentials:

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

## Exchange Online setup (browser only)

The app signs in with **delegated** permissions, so it can only read mailboxes the signed-in person can open. There is no client secret and no PowerShell.

1. **Entra admin center** → *App registrations → New registration*. Single tenant. Under *Authentication → Add a platform → Mobile and desktop applications*, add the redirect URI `http://localhost:3000/api/auth/callback`. Copy the tenant ID and client ID.
2. *API permissions → Add → Microsoft Graph → Delegated permissions*: `Mail.Read`, `Mail.Read.Shared` (and `offline_access`, `openid`, `profile`). If your tenant blocks user consent, click **Grant admin consent**.
3. **Exchange admin center** → *Recipients → Mailboxes* → the shared mailbox → *Delegation* → give the person who will sign in **Read and manage** access. That grant is what limits the app to this mailbox.
4. Put `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `DMARC_MAILBOX` in `.env.local`, run `pnpm dev` (port 3000), open <http://localhost:3000>, click **Sign in with Microsoft**, then **Fetch from mailbox**. Attachments in `.xml.gz` (also `.xml`, `.gz`, `.zip`) are decompressed and parsed.

The sign-in refresh token is stored in plain text in `.cache/auth/token.json` (`0600`, git-ignored). **Sign out** in the UI deletes it, and you can revoke access in Entra. Tokens expire eventually (or if your tenant's sign-in policies require it), and the UI then asks you to sign in again.

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
