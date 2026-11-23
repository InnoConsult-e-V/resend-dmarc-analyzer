# Sender-name data

`base_reverse_dns_map.csv` maps the base domain of a sending server's reverse DNS (or a DKIM, SPF or envelope-from domain) to the name and type of the organisation behind it. The app uses it to label sending sources, for example "Intuit Mailchimp (Marketing)".

- Source: https://github.com/domainaware/parsedmarc (`parsedmarc/resources/maps/base_reverse_dns_map.csv`)
- Retrieved: 2026-11-23
- Rows: 38,625 (SHA-256 434d03c07babc77c)
- Refresh: `pnpm update:senders`

## Licence

This data file is distributed under the **Creative Commons Attribution-ShareAlike 4.0 International** licence (CC BY-SA 4.0, https://creativecommons.org/licenses/by-sa/4.0/), as stated by the parsedmarc project, because many entries derive from IPinfo Lite data.

Attribution: the [parsedmarc](https://github.com/domainaware/parsedmarc) project (domainaware) and [IPinfo](https://ipinfo.io/) for the underlying network identification data.

If you redistribute or adapt this file, the same licence applies to it. This licence covers this data file only; the rest of the repository is under its own licence (see the top-level LICENSE).
