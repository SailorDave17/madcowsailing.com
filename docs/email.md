# Email for madcowhq.com and madcowsailing.com — runbook

Owner decision, 2026-09-17: **Zoho Mail Lite**, one paid seat, madcowhq.com as the
organisation's primary domain and madcowsailing.com as a second full domain on the same
account, with the one mailbox holding an address at each. This file is the setup record
and the place to check when mail for either domain misbehaves. It is not a spec for the
sites; the sites' `mailto:` links are covered at the foot.

## Where things stood before this

*Measured 2026-09-17* with `nslookup` against `1.1.1.1`: both zones on Cloudflare
nameservers (`dell.ns.cloudflare.com`, `lars.ns.cloudflare.com`), and **neither apex had
an MX, an SPF `TXT`, or a `_dmarc` record**. Nothing could receive at either domain.
The only mail-capable name under either was `taskr.madcowhq.com`, which Resend signs for
Taskr's Supabase auth mail (its return path is `rsend.taskr.madcowhq.com`). That
subdomain is untouched by everything below: its records are on the subdomain, and the
apex SPF added here does not cover or conflict with it.

Both sites publish `hsc.coach@gmail.com` in their `mailto:` links (19 occurrences across
`hq/` and `sailing/` at develop `724b012`). That stays true until a story changes it.

## Why Zoho Mail Lite, and what was rejected

The options were priced against their live pages on 2026-09-17. The decisive fact was
not price: **Google's Gmail help page says "Send mail as" for non-Google addresses ends
in January 2027**, with new configurations possibly restricted from Q3 2026. That
removes the usual free path — Cloudflare Email Routing forwarding into Gmail, with Gmail
sending back out through an SMTP relay — because the sending half has fifteen months to
live. Receiving through Email Routing is unaffected, but receive-only was not the ask.

| Option | Per month | Rejected because |
|---|---|---|
| Cloudflare Email Routing + Gmail send-as via Resend / SMTP2GO / Brevo | $0 | Gmail send-as retires January 2027 |
| Cloudflare Email Routing + Cloudflare Email Sending (beta, Workers Paid) | $5 | same Gmail dependency |
| Google Workspace Business Starter, madcowsailing.com as a free alias domain | $7 | works, but the owner chose the cheaper seat |
| Microsoft 365 Business Basic | $7 | same price as Workspace without the Google fit |
| Zoho Mail Free | $0 | one domain only, no IMAP — so no Outlook |
| iCloud+ custom domain | $0.99 | Apple-client shaped |
| Fastmail Individual | $6 | Workspace price without the apps |
| Proton Mail Plus | $3.99 | one custom domain; the second needs Unlimited at $9.99 |
| Purelymail / Migadu Micro | ~$1–1.60 | fine, but Migadu Micro caps outbound at 20 a day |
| **Zoho Mail Lite 5 GB** | **$1 (billed $12/year)** | **chosen**: real mailbox, multiple domains, IMAP/POP/ActiveSync for Outlook |

Mail Lite's 10 GB variant is $1.25 a month. Billing is annual only.

## The one Zoho feature not to use

Zoho has a feature literally called **domain aliasing**. Do not use it for
madcowsailing.com. Its own help page (Admin Console → Domains → Advanced Settings →
Domain Aliasing, read 2026-09-17) says the alias account "will not exist in Zoho" and
that "all domain level configurations such as DKIM, email routing, etc. will be removed"
when a domain becomes an alias. It is receive-only forwarding, and it strips the
authentication the second domain needs to send.

The setup that gives one mailbox a sendable address at both domains is:

1. madcowsailing.com added as a **second full domain**, verified, with its own MX, SPF,
   DKIM and DMARC; then
2. an **email alias** on the user at that domain. Zoho allows a user's aliases to sit
   on different verified domains in the organisation, and the compose window offers each
   as a From address.

## Setup

Every DNS record below goes in the Cloudflare dashboard for the zone named, with
**proxy off** (MX and TXT are never proxied; the CNAME verification method must be
grey-cloud or it fails). Zoho's own Cloudflare page is the source for the record
values: `zoho.com/mail/help/adminconsole/cloudflare.html`.

**1. Sign up.** `zoho.com/mail`, business email, **US data centre**, organisation domain
`madcowhq.com`, plan **Mail Lite 5 GB, one user**. Go straight to Lite; Free cannot
hold the second domain and has no IMAP.

**2. Verify madcowhq.com.** The admin console issues a TXT value. Add it as a `TXT` at
`@` in the madcowhq.com zone, then click verify.

**3. Create the mailbox.** One user — the local part is the owner's call; `dave@` is
the example used through this file. This is the paid seat.

**4. Mail records for madcowhq.com.** One SPF record per domain only — there was none
before this, so nothing to merge. Generate the DKIM key in Zoho first (Email
Configuration → DKIM, selector `zoho`), then paste it.

```
MX   @                 mx.zoho.com    10
MX   @                 mx2.zoho.com   20
MX   @                 mx3.zoho.com   50
TXT  @                 v=spf1 include:zohomail.com -all
TXT  zoho._domainkey   <the value Zoho generates — one key per domain>
TXT  _dmarc            v=DMARC1; p=none; rua=mailto:dave@madcowhq.com
```

DKIM verification in Zoho can lag the record by hours; the page says up to 48.

**5. Add madcowsailing.com as a second domain.** Admin console → Domains → Add domain.
Verify it with its own TXT, then add the same six records in the madcowsailing.com
zone. The DKIM value is different: Zoho issues one key per domain.

**6. Give the user the second address.** Users → the user → Mailbox settings → Email
alias → add `dave`, choose `madcowsailing.com`. Mail to either address now lands in the
one mailbox, and the From dropdown offers both.

**7. Prove it before trusting it.** From a Gmail account, send one message to each
address and confirm both arrive. Reply from each. In the reply as received, open the
original headers and read the `Authentication-Results` line: `spf=pass` and
`dkim=pass` **for the domain that sent**, not the other one. A reply from the
madcowsailing.com alias that shows `dkim=pass header.i=@madcowhq.com` means step 5's
DKIM is not live yet. Once both domains pass for a few weeks, move DMARC from
`p=none` to `p=quarantine`.

## Outlook

Mail Lite includes IMAP, POP and ActiveSync; this is what Free lacks and the reason to
pay for Lite rather than start Free.

First enable IMAP inside Zoho Mail: Settings → Mail Accounts → the address → tick
**IMAP Access**. If two-factor auth is on in Zoho, generate an **application-specific
password** for Outlook; the account password will be refused.

```
Incoming  imappro.zoho.com   993   SSL
Outgoing  smtppro.zoho.com   465   SSL   (587 with TLS also works)
Username  dave@madcowhq.com
```

Those are the **paid-organisation** hosts. `imap.zoho.com` / `smtp.zoho.com` are for
personal `@zohomail.com` accounts and reject an organisation login — the first thing to
check when Outlook says the credentials are wrong.

Classic Outlook for Windows lets the From field be changed to the madcowsailing.com
alias, and Zoho's SMTP accepts it because the alias belongs to the account. The new
Outlook is weaker on alternate From addresses for IMAP accounts; verify that in the
installed version before relying on it. Outlook mobile takes the same IMAP settings.

If copies should also reach the Gmail inbox, set forwarding **inside Zoho** with "keep a
copy". Do not use Gmail's "check mail from other accounts": Google is retiring that POP
fetch alongside send-as.

## What this does not change

- **The sites' `mailto:` links.** They still name the Gmail address. Switching them to
  the domain addresses is a story, filed when the mailbox has passed step 7, not a
  side-effect of this runbook. Both zones have Email Address Obfuscation **off**
  (#105), so whatever address the pages carry is served as written.
- **`taskr.madcowhq.com`.** Resend keeps signing Taskr's auth mail on the subdomain.
- **Hosting.** Pages, the custom domains and the Redirect Rules are as `CLAUDE.md`
  describes; MX and TXT records sit beside them in the same zones.

## Sources read on 2026-09-17

Gmail "Send emails from a different address or alias" help (the January 2027 notice);
Cloudflare Email Routing limits and Email Service docs; Resend, SMTP2GO, Brevo pricing;
Google Workspace pricing and the alias-domain vs secondary-domain help; Zoho Mail
pricing, the Cloudflare DNS page, the domain-aliasing page, the email-alias how-to and
the IMAP access page; iCloud+ custom email domain support page; Fastmail, Proton,
Purelymail and Migadu pricing pages.
