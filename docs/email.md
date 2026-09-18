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

*Run on 2026-09-17/18 in a driven browser with the owner watching; the paragraphs below
say what each step actually did, where that differed from the plan.*

**1. Sign up.** The Mail Lite sign-up link off the pricing page is
`mail.zoho.com/signup?type=org&plan=newMail5gb`. It creates a **Zoho account** (name,
login email, password) — not yet a mailbox — and drops into an Email Setup wizard whose
first step adds the organisation's first domain (`madcowhq.com`, organisation name
`Mad Cow`, industry picked from a fixed list; a ZeptoMail box is unticked by default and
stays so). The wizard then hands off to the Zoho Store, where the **user count is an
empty field** and the total reads $0.00 until `1` is typed into it; one seat, yearly,
came to $12.00 with renewal on 16 Sep 2027.

**2. Verify each domain by Domain Connect, not by pasting a TXT.** On a Cloudflare zone,
Zoho's **Log in to my DNS** button opens a Cloudflare tab (sign-in, then an *Authorize
DNS records from Zoho* screen listing exactly what will be written, all DNS-only). It is
pressed **twice per domain**: once for the ownership TXT
(`zoho-verification=zb…zmverify.zoho.com`), and once more on the DNS Mapping step for
the three MX, the SPF and the DKIM key. Each authorisation is one-time; the tab closes
itself on success. *Measured* at Cloudflare's authoritative server seconds later: all
five records present on both domains. The public resolver kept serving the negative
answer it had cached earlier, so check `dell.ns.cloudflare.com` directly.

**3. The paid seat is the admin account itself.** After sign-up the Users list already
holds one user — the admin, identified by the Gmail login — and the licence count reads
one. The mailbox is created **on that user**: Users → the admin → **Create mail
account** → local part `dave` + domain `madcowhq.com`. Adding a second user would have
needed a second licence. The Gmail address stays the *login* email; `dave@madcowhq.com`
is the mailbox address.

**4. What Domain Connect wrote, per zone** (*measured* at the authoritative server,
2026-09-18). Note the selector is **`zmail`**, not the `zoho` Zoho's Cloudflare help page
shows, and the SPF ends **`~all`**, not `-all`. One SPF record per domain only — there
was none before this, so nothing to merge.

```
MX   @                  mx.zoho.com    10
MX   @                  mx2.zoho.com   20
MX   @                  mx3.zoho.com   50
TXT  @                  v=spf1 include:zohomail.com ~all
TXT  @                  zoho-verification=zb<code>.zmverify.zoho.com   (ownership; harmless to keep)
TXT  zmail._domainkey   v=DKIM1; k=rsa; p=…   (one key per domain)
```

**Zoho does not mark DKIM verified on its own, even when it wrote the record.** The
domain list read *Yet to configure DKIM* with the key live. The fix is Domains → the
domain → Email Configuration → DKIM → click the `zmail._domainkey` row → **Configure
manually** → **Verify**; both domains returned *DKIM selector is successfully verified*
at once. MX and SPF it re-checks by itself.

**DMARC is not part of the template.** Add it by hand in each zone:

```
TXT  _dmarc   v=DMARC1; p=none; rua=mailto:dave@madcowhq.com
```

**5. Add madcowsailing.com as a second domain.** Admin console → Domains → **Add an
existing domain** (one field), then the same two Domain Connect authorisations as step 2.
Its DKIM key is different: Zoho issues one per domain.

**6. Give the user the second address.** Users → the user → **Mailbox Settings** → Email
Alias → Add: display name, alias `dave`, the domain dropdown switched to
`madcowsailing.com`, and **leave "Set as Mailbox Address" unticked**. A "Welcome to the
Admin Console" dialog intercepts clicks on this page until it is closed. Mail to either
address now lands in the one mailbox, and the From dropdown offers both.

**7. Prove it before trusting it.** The outbound half was *measured* on 2026-09-18 with
mail-tester.com, one throw-away address per sending identity (the Gmail connector
that would have read the headers had lost its authorisation, and mail-tester needs no
login):

| Sent from | Score | SPF | DKIM |
|---|---|---|---|
| dave@madcowhq.com | 9.4 / 10 | pass, envelope-from `dave@madcowhq.com`, via `include:zohomail.com` | valid, `d=madcowhq.com` |
| dave@madcowsailing.com | 9.4 / 10 | pass, envelope-from `dave@madcowsailing.com` | valid, `d=madcowsailing.com` |

The `d=` is the check that matters: the alias signs under **its own** domain, which
is what the full-domain-plus-alias shape in step 6 buys and Zoho's domain aliasing
would not. The 0.6 deducted on both was *You do not have a DMARC record*, closed by the
`_dmarc` records in step 4, which were live at the authoritative server on 2026-09-18.
The inbound half was *measured* the same night: the owner replied from Gmail to both
test messages, and each reply landed in the Zoho inbox on the thread of the address it
was sent to, within a minute. (Zoho's own welcome mail is internal and proves nothing
about MX; an outside sender does.) Once both domains have run clean for a few weeks,
move DMARC from `p=none` to `p=quarantine`.

## Outlook

Mail Lite includes IMAP, POP and ActiveSync; this is what Free lacks and the reason to
pay for Lite rather than start Free.

First enable IMAP inside Zoho Mail (the webmail, not the admin console): Settings →
Mail accounts → the account → the **IMAP** tab → tick **IMAP Access** → **and press
the Save button that appears below the section.** *Measured 2026-09-18*: the tick
alone reads as on until the page is reloaded, then reverts, and Outlook reports the
refused IMAP login as a wrong password — Zoho's Login History shows no attempt at all,
because the connection never got as far as authenticating. The admin console's Access
Restrictions page only *blocks* protocols by policy; with no restriction defined, this
per-user switch is the whole control, and two-factor was off, so no app password was
involved. If two-factor auth is
on in Zoho, generate an **application-specific password** for Outlook; the account
password will be refused.

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

**As run, 2026-09-18.** New Outlook for Windows connected over IMAP once the switch
above was actually saved. It sends through Zoho's SMTP (*measured*: the message appeared
in Zoho's Sent folder), but it offers **only dave@madcowhq.com in the From line** — the
alias is not selectable for an IMAP account, as predicted. Three ways round it: Zoho's
web app or mobile app (the From dropdown offers both); classic Outlook's From → Other
Email Address; or **a second IMAP account in new Outlook with the username
`dave@madcowsailing.com`** and the same password and servers — Zoho's IMAP page states
that an organisation user's alias is accepted as the IMAP username, and an account
signed in as the alias sends as the alias. The cost is the same mailbox shown twice.
*Measured 2026-09-18*: Outlook for Android, signed in with the alias as username, sent a
message that arrived in Gmail from dave@madcowsailing.com.

**Expect the first message from each address to land in Gmail's spam.** Both did, and
Gmail's banner gave the same reason each time — *similar to messages that were identified
as spam in the past* — which is its content classifier, not an authentication failure
(that reads *could not be verified*). A one-word subject and body, a day-old domain and
Outlook's *Get Outlook for Android* link are the shape it matched. *Report not spam* is
per sender, so each address needs its own; the next message from each reached the inbox.
Send a real sentence for the first message, and add both addresses to the recipient's
contacts.
The first Outlook-sent message landed in Gmail's spam on reputation (day-old domain,
one-word subject), not authentication; after one *Not spam* the next arrived in the
inbox. Each Outlook send also produced **two** copies in Zoho's Sent folder, one from
Zoho's SMTP and one from Outlook's IMAP sync, so the IMAP tab's **Save copy of sent
emails** is now **off**, saved and confirmed after a reload; webmail sends are saved
regardless.

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
