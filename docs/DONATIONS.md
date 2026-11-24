# Donations: plan, setup and operations

How sohamhamso accepts one-time gifts. There are no subscriptions anywhere.
Every payment runs through one Stripe account (US, maintainer), including UPI for India.
Status (24 Nov 2026): live Stripe account verified; live keys, webhook and ledger D1 configured.
Without a publishable key the page shows an honest "being set up" state.

## 1. Rails

| Rail | Who it's for | Payee | Fee to the project | Shows up in the ledger |
|---|---|---|---|---|
| **Stripe, UPI** (INR) | Donors paying from Indian bank accounts | Maintainer (US); settles in USD | 2% + 1.5% cross-border + 1% conversion ≈ **4.5%**, no fixed fee | Webhook, automatic |
| **Stripe, card / Apple Pay / Google Pay / Link** | Everyone else | Maintainer (US) | 2.9% + 30¢ (+1.5% non-US cards) | Webhook, automatic |
| **Stripe, US bank** (Instant Bank Payments / ACH) | US donors, best for $100+ | Maintainer (US) | 2.6% + 30¢ / 0.8% capped at $5 | Webhook, automatic |
| **GitHub Sponsors** (one-time tiers) | Developers | GitHub Sponsors account (TBD: `dannyb66` or a `sohamhamso` org) | **0%** from personal accounts | Manual (phase 2: webhook) |
| **YouTube Super Thanks** | Viewers inside YouTube | AdSense payee | YouTube keeps 30% | Manual monthly row |
| **Bank transfer / Zelle, on request** | Gifts of $500 or more | Maintainer (US) | $0 | Manual |

These are deliberately **not** used:

- **PayPal Friends & Family, personal Venmo, personal Cash App.** Their terms exclude donations and commercial payments.
- **Open Collective / Open Source Collective.** 10% fee, and gifts still aren't tax-deductible (OSC is a 501(c)(6)).
- **Buy Me a Coffee** (5%).
- **Liberapay** (recurring only).
- **Crypto.**
- **Direct UPI to an Indian bank account / Paytm merchant QR.** Cheaper (≈0%), but the money would land in an Indian account held by a US resident (NRO/FEMA questions), the ledger would need manual CSV imports, and the payee name still shows the legal name without a registered business. Stripe UPI avoids all three for ≈4.5%.

## 2. Donor experience (`/donate`)

- **The method follows how the donor pays.** Location only picks the default tab: UPI for India (timezone first, then Cloudflare `/cdn-cgi/trace`), card everywhere else. You can force a tab with `?method=upi|card`.
- **UPI (Stripe Payment Element in INR, UPI only):**
  - preset ₹ amounts (₹101 / 251 / 501 / 1,001 / 2,101, ₹501 preselected) or any amount between ₹100 and ₹1,00,000;
  - optional **"cover the fees"** top-up at 4.5% (`feeCoverMinor(base, 'inr')`) and optional ledger name;
  - **desktop**: Stripe shows a QR to scan with any UPI app and waits on the page (5-minute window);
  - **mobile**: the donor picks a UPI app, approves with their PIN and is returned to `/donate/thanks`, which reads the real PaymentIntent status;
  - the donor's UPI app shows the account's **legal name** (UPI rule) together with the statement descriptor `SOHAMHAMSO.ORG`.
- **Card:**
  - preset $ amounts, with $11 preselected, or a custom amount between $3 and $5,000;
  - optional **"cover the fees"** top-up (`feeCoverMinor`: gross = (base + 30¢) / (1 − 2.9%));
  - optional name for the public ledger;
  - **Apple Pay / Google Pay / Link** buttons, then a Payment Element for card or bank, all embedded with no redirect;
  - an inline thank-you; `/donate/thanks` handles the methods that do redirect.
- **Attribution:** `?src=` (`yt`, `yt-pin`, `yt-qr`, `repo`, …) flows into PaymentIntent metadata and from there into the ledger's `source`.
- **Performance:** Stripe.js loads once, only when a tab is shown.
- **Currency rule:** the browser's Elements options and the server's PaymentIntent must agree: `inr` ↔ Elements `allowedPaymentMethodTypes: ['upi']` + PaymentIntent `allowed_payment_method_types: ['upi']`, `usd` ↔ automatic payment methods. (Stripe.js Endive rejects the old `paymentMethodTypes`; API Endive removes `payment_method_types`.) Both read `donateBounds()` / `donationTotalMinor()` so amounts always match.

## 3. Code map

```
src/lib/donate/config.ts        public config (presets, bounds, sponsor/contact URLs): fill in the TODOs
src/lib/donate/amounts.ts       shared amount maths (USD + INR), validation, sanitisers
src/lib/donate/stripe.ts        fetch-based Stripe client (PaymentIntents) + webhook signature check
src/lib/donate/ledger.ts        webhook → LEDGER_DB
src/components/donate/DonatePanel.astro   UI (used by /donate and /[lang]/donate)
src/scripts/donate.ts           client behaviour
src/pages/api/donate/intent.ts          POST: create PaymentIntent (server recomputes the amount)
src/pages/api/donate/stripe-webhook.ts  POST: Stripe events → ledger
src/pages/donate/thanks.astro           return_url (noindex)
migrations-ledger/0001_ledger.sql       ledger schema (separate D1 from PII_DB)
tests/unit/donate.test.ts               unit tests
tests/e2e/donate.spec.ts                browser tests with Stripe.js stubbed (needs PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_… on the dev server)
```

## 4. Setup checklist

### 4.1 India (UPI through Stripe)
1. Dashboard → Settings → **Payment methods → UPI → Enable**, in both the sandbox and live. The account's industry must not be a UPI-prohibited MCC (8661 "Religious Organizations" is prohibited; this account is "Other educational services").
2. Nothing else to configure: the INR form requests UPI explicitly.
3. Before announcing: a live **₹101 UPI payment from Google Pay or PhonePe**, on desktop (QR) and on a phone (app switch). Check the ledger row appears in INR, then refund it.

### 4.2 Stripe (US account, maintainer)
1. Create the Stripe account as an individual or sole proprietor. Describe the business as **"educational text reader and publisher; supporters make voluntary contributions"**. Don't call it a charity: it isn't a 501(c)(3). Set the statement descriptor to `SOHAMHAMSO`.
2. Dashboard → Settings → **Payment methods**: turn on Cards, Apple Pay, Google Pay, Link, **ACH Direct Debit**, **Instant Bank Payments** and **UPI**. Turn off pay-later methods (Klarna, Affirm, Afterpay), including Klarna inside Link. Under **Payment method domains**, register `sohamhamso.org`.
3. Dashboard → Developers → **API keys → create restricted key** with only *PaymentIntents: Write*. Store it as the `STRIPE_SECRET_KEY` Pages secret.
4. Pages → Settings → Variables: set `PUBLIC_STRIPE_PUBLISHABLE_KEY`, with `pk_test_…` for **Preview** and `pk_live_…` for **Production**.
5. Webhook endpoint: `https://sohamhamso.org/api/donate/stripe-webhook`, API version `2026-08-26.dahlia` (same as `STRIPE_API_VERSION` in `stripe.ts`). Events: `payment_intent.succeeded`, `charge.refunded`, plus `checkout.session.completed` if you use Payment Links. Store the signing secret as the `STRIPE_WEBHOOK_SECRET` Pages secret. The sandbox has its own webhook pointed at the preview deployment; test events are stored hidden (`stripe-test:` ids).
6. **Abuse controls.** Card-testing bots go after donation forms.
   - Cloudflare → Security → WAF → **rate limiting rule**: `URI Path equals /api/donate/intent`, 10 requests per minute per IP, block for 10 minutes.
   - Stripe Radar rules: block if `:card_count_for_ip_address_hourly: > 3`; review payments under $5 from new cards if attacks happen.
7. Before announcing: a live **$3 card payment, then refund it**, a **$3 Apple Pay payment** and a **₹101 UPI payment**. Check the ledger rows appear and the refund hides its row.

### 4.3 Ledger
1. Done: `sohamhamso-ledger` exists, `LEDGER_DB` is bound in `wrangler.toml`, and `0001_ledger.sql` is applied.
2. Every Stripe rail (card, wallets, bank, UPI) is recorded by the webhook; nothing is imported by hand. INR gifts are stored in paise with `currency = 'INR'`.
3. Public page (phase 2): read `ledger_public` (it never exposes `external_ref`). Show ₹ and $ totals separately, never converted, so anyone can check them against statements.

### 4.4 GitHub Sponsors
1. Decide which account runs it (`dannyb66`, or a `sohamhamso` org). The site currently links issues and discussions to `github.com/sohamhamso/sohamhamso`, but the repository lives at `dannyb66/sohamhamso`. Fix those links whichever way you decide.
2. Sign up for Sponsors and add one-time tiers ($5 / $25 / $100) plus custom amounts. The payout bank account must be in the same country you live in.
3. Set `donateConfig.githubSponsorsUrl` and uncomment `github:` in `.github/FUNDING.yml`.

### 4.5 YouTube: see section 6 and [YOUTUBE-SUPPORT-KIT.md](YOUTUBE-SUPPORT-KIT.md).

## 5. Legal and tax notes (not advice; confirm with a CPA (US) and a CA (India))

- **US (maintainer):** Stripe and Sponsors gifts are most likely taxable income for an individual creator. Stripe issues a 1099-K above the reporting threshold. The page says, correctly, that gifts are **not tax-deductible**.
- **India:** with every rail on the US Stripe account, no Indian resident or Indian bank account receives gifts, so the earlier ₹50,000 gift-tax and FCRA concerns about an India payee no longer apply. UPI gifts are cross-border payments from the donor's side (handled by Stripe and its Indian partner).
- **Stripe UPI** requires the payer's app to show the account's legal name. A registered business name would replace the individual's name only if the Stripe account itself became a business account.

## 6. YouTube Partner Program (needed for Super Thanks)

**Status (checked in Studio on 23 Nov 2026):** 971 subscribers. "Base terms" accepted, **AdSense not linked**, **review not started**. Thresholds for fan-funding features: 500 subscribers, 3 public uploads in the last 90 days, and 3,000 watch hours in 12 months *or* 3M Shorts views in 90 days. Thresholds for ad revenue: 1,000 subscribers and 4,000 hours *or* 10M Shorts views.

### 6.1 Decide the payee first
The AdSense account holder receives YouTube income and pays tax on it. Pick one:

| Payee | AdSense country | US tax form in AdSense | US withholding | Notes |
|---|---|---|---|---|
| **Maintainer (US)** | US | W-9 | 0% with valid info | Simplest. Income goes on your US return. |
| **Family member (India)** | India | W-8BEN + India treaty claim | **15%** of earnings from US viewers; **24% of all earnings** if no tax info is submitted | Indian income tax on top. Payments are made by Google, so they aren't FCRA "foreign contributions"; confirm with your CA. |

Changing the AdSense payee later is painful, so decide before you link.

### 6.2 Steps
1. Turn on **2-step verification** on the channel's Google account.
2. Studio → **Earn** → Step 2: **Sign up for AdSense for YouTube** (or link the payee's existing AdSense). The name and address must match the payee's ID and bank.
3. Review starts automatically and usually takes about a month. A human reviews the channel's main theme, most-viewed videos, newest videos, watch time and metadata.
4. After acceptance:
   - **Earn → Supers → Super Thanks: on.**
   - **Super Chat:** only if you stream.
   - **Channel memberships: off.** They're a subscription, which the no-subscriptions rule excludes.
   - **Ads:** your call. The site is ad-free, and you can join YPP and turn ads off per video, keeping only fan funding.
5. AdSense → Payments: add the bank account, submit **US tax info** (6.1), and set a payment threshold.

### 6.3 Biggest risk: the "inauthentic content" policy
YPP won't monetize **mass-produced, repetitive or template-based** content. YouTube tightened this in July 2025 and clarified it again in July 2026. This channel's pipeline uses **speech synthesis and template-based Remotion/FFmpeg composition**, including automated Shorts. A reviewer could read that as templated content, even though every verse is distinct. Do this before review starts:

- **Lead with your most original work:** the channel's main theme, top videos and newest uploads should show human value, such as recitation in your own or a reciter's voice, commentary, context or explanations. Templated verse cards shouldn't dominate.
- **Vary the formats:** chapter explainers, word-by-word walkthroughs, Q&A. Avoid long runs of near-identical Shorts.
- **Turn on the "altered or synthetic content" disclosure** for realistic synthetic voices where it applies. AI use is allowed; undisclosed realistic synthetic media isn't.
- **Pause the automated Shorts upload cron** (Cron B is already on hold) until review passes.
- **Copyright:** lyric videos that use third-party recitation audio can draw Content ID claims. Claimed videos can't carry Super Thanks, and reused audio can fail review. Check the Content → Copyright column, and use your own or licensed audio.

If the channel is rejected, you can reapply after 30 days, once the issues are fixed (a 90-day wait applies for repeat rejections).

### 6.4 Where YouTube fits in the plan
Super Thanks is a **convenience** for viewers who'd rather tap inside YouTube. YouTube keeps 30%, so every video still points to `sohamhamso.org/donate?src=yt`, where UPI costs about 4.5% and cards about 3–5%. Description, pinned-comment, QR and outro templates are in [YOUTUBE-SUPPORT-KIT.md](YOUTUBE-SUPPORT-KIT.md).

## 7. Rollout order

1. **Stripe test mode on Preview:** push the branch; Preview already has `pk_test`, the test restricted key and the sandbox webhook secret. Click through a test card (4242 4242 4242 4242), a declined card (4000 0000 0000 0002) and a UPI test payment (authorize and fail on Stripe's test page). Confirm the sandbox webhook deliveries succeed and `stripe-test:` rows appear in the ledger.
2. **Stripe live:** merge to main (Production has the live keys, webhook and ledger binding). Add the WAF rate-limit rule. Run the live $3 card / ₹101 UPI tests, refund, then announce.
3. **YouTube:** update descriptions and pinned comments (the kit) right away. Link AdSense after deciding the payee and doing the content clean-up in 6.3.
4. **GitHub Sponsors:** once the account question is settled.
5. **Ledger page:** after the first month of data.
