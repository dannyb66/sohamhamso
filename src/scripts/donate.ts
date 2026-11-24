/**
 * Client behaviour for DonatePanel. Loaded as a bundled Astro <script>.
 *
 * - Method tabs: default to UPI for visitors in India (timezone, then
 *   Cloudflare's /cdn-cgi/trace), card elsewhere; always switchable;
 *   `?method=upi|card` forces one.
 * - Each tab is a Stripe "rail" form (deferred-intent flow): amount chips,
 *   optional fee cover, optional ledger name, Payment Element (+ Express
 *   Checkout for card). On submit the server creates the PaymentIntent in
 *   the rail's currency and the browser confirms it.
 *     upi  → INR, `allowedPaymentMethodTypes: ['upi']` (QR on desktop, app switch
 *            on mobile; mobile returns via /donate/thanks)
 *     card → USD, automatic payment methods (card, wallets, Link, ACH)
 * - Stripe.js is loaded once, lazily, when the first rail is shown.
 */
import type {
  Stripe,
  StripeElements,
  StripeElementsOptionsMode,
  StripeExpressCheckoutElement,
  StripePaymentElement,
} from '@stripe/stripe-js';
import {
  type DonateCurrency,
  donationTotalMinor,
  feeCoverMinor,
  formatMoney,
  parseMajorToMinor,
} from '../lib/donate/amounts';

type Method = 'upi' | 'card';

function inIndiaByTimezone(): boolean {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  return tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta';
}

function sourceTag(): string {
  const raw = new URLSearchParams(location.search).get('src') ?? 'site';
  return raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'site';
}

function uuid(): string {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-donate`;
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(pk: string): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = import('@stripe/stripe-js').then(({ loadStripe }) => loadStripe(pk));
    stripePromise.catch(() => {
      stripePromise = null; // allow a retry after a network failure
    });
  }
  return stripePromise;
}

export function initDonate(): void {
  const root = document.querySelector<HTMLElement>('[data-donate]');
  if (!root) return;
  const pk = root.dataset.pk ?? '';

  const rails = new Map<Method, { activate: () => void }>();
  for (const form of Array.from(root.querySelectorAll<HTMLFormElement>('[data-rail-form]'))) {
    const rail = initRail(form, pk);
    if (rail) rails.set(form.dataset.method as Method, rail);
  }

  // ── Tabs ────────────────────────────────────────────────────────────
  const tabsEl = root.querySelector<HTMLElement>('[data-tabs]');
  const tabs = Array.from(root.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  const panels = Array.from(root.querySelectorAll<HTMLElement>('[role="tabpanel"]'));

  function select(method: Method, focus = false): void {
    const tab = tabs.find((t) => t.dataset.method === method) ?? tabs[0];
    if (!tab) return;
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    for (const p of panels) p.hidden = p.dataset.panel !== tab.dataset.method;
    if (focus) tab.focus();
    rails.get(tab.dataset.method as Method)?.activate();
  }

  if (tabs.length > 1 && tabsEl) {
    tabsEl.hidden = false;
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => {
        root.dataset.touched = '1';
        select(t.dataset.method as Method);
      });
      t.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
        if (next) select(next.dataset.method as Method, true);
      });
    });

    const forced = new URLSearchParams(location.search).get('method');
    if (forced === 'upi' || forced === 'card') select(forced);
    else if (inIndiaByTimezone()) select('upi');
    else {
      select('card');
      fetch('/cdn-cgi/trace', { cache: 'no-store' })
        .then((r) => (r.ok ? r.text() : ''))
        .then((t) => {
          // Only switch if the donor hasn't interacted yet.
          if (/^loc=IN$/m.test(t) && !root.dataset.touched) select('upi');
        })
        .catch(() => {});
    }
    root.addEventListener(
      'pointerdown',
      () => {
        root.dataset.touched = '1';
      },
      { once: true },
    );
  } else {
    // No tabs (one rail, or several stacked): activate every rail.
    for (const r of rails.values()) r.activate();
  }
}

function initRail(form: HTMLFormElement, pk: string): { activate: () => void } | null {
  if (!pk) return null;
  const panel = form.closest<HTMLElement>('[data-panel]') ?? form;
  const currency: DonateCurrency = form.dataset.currency === 'inr' ? 'inr' : 'usd';
  const min = Number(form.dataset.min) * 100;
  const max = Number(form.dataset.max) * 100;
  const withExpress = form.dataset.express === '1';

  const chips = Array.from(form.querySelectorAll<HTMLButtonElement>('[data-minor]'));
  const custom = form.querySelector<HTMLInputElement>('[data-custom]');
  const cover = form.querySelector<HTMLInputElement>('[data-cover-fees]');
  const feeLabel = form.querySelector<HTMLElement>('[data-fee-amount]');
  const totalLabel = form.querySelector<HTMLElement>('[data-total]');
  const submit = form.querySelector<HTMLButtonElement>('[data-submit]');
  const errorEl = form.querySelector<HTMLElement>('[data-error]');
  const nameInput = form.querySelector<HTMLInputElement>('[data-ledger-name]');
  const expressMount = form.querySelector<HTMLElement>('[data-express-element]');
  const paymentMount = form.querySelector<HTMLElement>('[data-payment-element]');
  const divider = form.querySelector<HTMLElement>('[data-express-divider]');
  const thanks = panel.querySelector<HTMLElement>('[data-thanks]');
  const thanksText = panel.querySelector<HTMLElement>('[data-thanks-text]');

  const pressed = chips.find((c) => c.getAttribute('aria-pressed') === 'true');
  let baseMinor = pressed ? Number(pressed.dataset.minor) : min;
  let idempotencyKey = uuid();
  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;
  let started = false;
  let ready = false;
  let busy = false;

  const fmt = (minor: number) => formatMoney(minor, currency);
  const total = () => donationTotalMinor(baseMinor, cover?.checked ?? false, currency);
  const valid = () => baseMinor >= min && baseMinor <= max;

  function showError(msg: string | null): void {
    if (!errorEl) return;
    errorEl.textContent = msg ?? '';
    errorEl.hidden = !msg;
  }

  function refresh(newIntent = true): void {
    if (feeLabel) feeLabel.textContent = fmt(feeCoverMinor(Math.max(baseMinor, 0), currency));
    if (totalLabel) totalLabel.textContent = fmt(valid() ? total() : Math.max(baseMinor, 0));
    if (submit) submit.disabled = busy || !valid() || !ready;
    if (newIntent) idempotencyKey = uuid(); // new amount → new intent
    if (elements && valid()) elements.update({ amount: total() });
  }

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
      if (custom) custom.value = '';
      baseMinor = Number(chip.dataset.minor);
      showError(null);
      refresh();
    });
  }
  custom?.addEventListener('input', () => {
    const minor = parseMajorToMinor(custom.value);
    for (const c of chips) c.setAttribute('aria-pressed', 'false');
    if (minor === null) {
      showError(custom.value ? 'Enter an amount like 15 or 15.50.' : null);
      baseMinor = 0;
    } else {
      baseMinor = minor;
      showError(
        minor < min
          ? `The minimum gift is ${fmt(min)}.`
          : minor > max
            ? `For more than ${fmt(max)}, please contact us.`
            : null,
      );
    }
    refresh();
  });
  cover?.addEventListener('change', () => refresh());

  async function createIntent(): Promise<string> {
    const res = await fetch('/api/donate/intent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        currency,
        baseCents: baseMinor,
        coverFees: cover?.checked ?? false,
        source: sourceTag(),
        ledgerName: nameInput?.value ?? '',
        idempotencyKey,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      clientSecret?: string;
      message?: string;
    };
    if (!res.ok || !data.clientSecret)
      throw new Error(data.message ?? 'Could not start the payment.');
    return data.clientSecret;
  }

  function showThanks(status: string): void {
    form.setAttribute('hidden', '');
    if (thanksText && status === 'processing') {
      thanksText.textContent =
        'Your payment is processing. Stripe will email you a receipt once it clears.';
    }
    if (thanks) {
      thanks.hidden = false;
      thanks.focus();
    }
  }

  async function confirm(): Promise<{ ok: boolean; message?: string }> {
    if (!stripe || !elements) return { ok: false, message: 'Payment form not ready.' };
    const clientSecret = await createIntent();
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret,
      confirmParams: { return_url: `${location.origin}/donate/thanks` },
      redirect: 'if_required',
    });
    if (error) {
      idempotencyKey = uuid(); // a failed intent can't be reused for a fresh attempt
      return { ok: false, message: error.message ?? 'The payment did not go through.' };
    }
    const status = paymentIntent?.status ?? 'succeeded';
    if (status === 'requires_payment_method' || status === 'canceled') {
      idempotencyKey = uuid();
      return { ok: false, message: 'The payment did not go through. Nothing was charged.' };
    }
    showThanks(status);
    return { ok: true };
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!elements || busy || !valid()) return;
    busy = true;
    showError(null);
    refresh(false);
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message ?? 'Check your payment details.');
      const r = await confirm();
      if (!r.ok) throw new Error(r.message);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      busy = false;
      refresh(false);
    }
  });

  async function start(): Promise<void> {
    if (started) return;
    started = true;
    try {
      stripe = await getStripe(pk);
      if (!stripe) throw new Error('Stripe failed to load');
      const options: StripeElementsOptionsMode = {
        mode: 'payment',
        amount: valid() ? total() : min,
        currency,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: cssVar('--color-accent', '#7a1f18'),
            colorBackground: cssVar('--color-surface', '#ffffff'),
            colorText: cssVar('--color-ink', '#1c1a17'),
            colorDanger: cssVar('--color-error', '#b42318'),
            borderRadius: '6px',
          },
        },
      };
      // Must match the server's PaymentIntent (stripe.ts). Assigned (not spread)
      // so the type checker validates the option name: Stripe.js (Endive)
      // rejects the old `paymentMethodTypes` outright.
      if (currency === 'inr') options.allowedPaymentMethodTypes = ['upi'];
      elements = stripe.elements(options);

      if (withExpress && expressMount) {
        const express: StripeExpressCheckoutElement = elements.create('expressCheckout', {
          buttonHeight: 48,
          buttonType: { applePay: 'donate', googlePay: 'donate' },
        });
        express.on('ready', ({ availablePaymentMethods }) => {
          if (availablePaymentMethods && divider) divider.hidden = false;
        });
        express.on('click', (ev) => {
          if (!valid()) {
            showError(`Choose an amount between ${fmt(min)} and ${fmt(max)}.`);
            return;
          }
          ev.resolve();
        });
        express.on('confirm', async (ev) => {
          try {
            const r = await confirm();
            if (!r.ok) {
              ev.paymentFailed({ reason: 'fail' });
              showError(r.message ?? 'The payment did not go through.');
            }
          } catch (err) {
            ev.paymentFailed({ reason: 'fail' });
            showError(err instanceof Error ? err.message : 'Something went wrong.');
          }
        });
        express.mount(expressMount);
      }

      if (paymentMount) {
        paymentMount.textContent = '';
        const payment: StripePaymentElement = elements.create('payment', {
          layout: currency === 'inr' ? 'tabs' : 'accordion',
        });
        payment.on('ready', () => {
          ready = true;
          refresh(false);
        });
        payment.on('loaderror', (ev) => {
          console.error('[donate] payment element', ev.error);
          showError('The payment form could not load. Please refresh and try again.');
        });
        payment.mount(paymentMount);
      }
    } catch (err) {
      started = false;
      if (paymentMount)
        paymentMount.textContent =
          'The payment form could not load. Check your connection and try again.';
      console.error('[donate]', err);
    }
  }

  refresh();
  return { activate: () => void start() };
}
