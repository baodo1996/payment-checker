/**
 * RAZER AUTO ORDER CHECKER — Real Chrome via chrome-launcher + puppeteer.connect()
 * 
 * WHY THIS WORKS:
 * - chrome-launcher launches YOUR system Chrome as a normal user would
 * - puppeteer.connect() just attaches to the existing browser via CDP
 * - No Puppeteer launch hooks, no --enable-automation, authentic TLS fingerprint
 * - All fingerprint spoofing still applied via evaluateOnNewDocument
 */
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const net = require('net');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const chromeLauncher = require('chrome-launcher');

// ──── UTILS ────
const sleep = ms => new Promise(r => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randSleep = (base, v = 500) => sleep(base + randInt(-v, v));

// ──── CHROME LAUNCH (independent, no Puppeteer) ────
async function launchChromeViaLauncher(headful) {
  const flags = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--disable-features=TranslateUI',
    '--lang=en-US',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-field-trial-config',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--no-default-browser-check',
    '--no-first-run',
    `--window-size=${randInt(1366, 1920)},${randInt(720, 1080)}`,
  ];

  if (headful) {
    flags.push('--start-maximized');
  } else {
    flags.push('--headless=new');
  }

  // PERSISTENT profile: a warm session (cookies from prior visits) is what makes Razer's
  // Angular checkout render its form. A totally-fresh temp profile gets served a "Loading..."
  // shell forever (anti-bot). We keep the profile but CLEAR THE CART via UI before each run
  // (see clearCartAndCheckout) so it never accumulates 19 items like before.
  const profileDir = path.join(__dirname, '..', '.browser-profile');
  fs.mkdirSync(profileDir, { recursive: true });

  // Stale Chrome processes from a previous run hold a lock on this profile dir and exit
  // instantly when a new Chrome tries to use it → ECONNREFUSED on the debug port. Kill them
  // and remove singleton lock files before launching.
  killChromeOnProfile(profileDir);
  for (const f of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'Singleton']) {
    try { fs.rmSync(path.join(profileDir, f), { force: true }); } catch (e) {}
  }

  // Launch with retry + verify the debug port actually responds before returning
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const chrome = await chromeLauncher.launch({
        chromeFlags: flags,
        ignoreDefaultFlags: true,
        userDataDir: profileDir,
      });
      await waitForPort(chrome.port, 10000);
      return chrome;
    } catch (e) {
      lastErr = e;
      await sleep(2500);
      killChromeOnProfile(profileDir);
    }
  }
  // IMPORTANT: do NOT wipe the profile unless we truly must — a warm profile (prior
  // cookies/session) is what makes Razer render the checkout form. A fresh profile gets
  // served a "Loading..." shell forever. Only wipe if the launch still fails after cleanup.
  try { fs.rmSync(path.join(profileDir, 'SingletonLock'), { force: true }); } catch (e) {}
  try { fs.rmSync(path.join(profileDir, 'SingletonSocket'), { force: true }); } catch (e) {}
  try { fs.rmSync(path.join(profileDir, 'SingletonCookie'), { force: true }); } catch (e) {}
  killChromeOnProfile(profileDir);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const chrome = await chromeLauncher.launch({
        chromeFlags: flags,
        ignoreDefaultFlags: true,
        userDataDir: profileDir,
      });
      await waitForPort(chrome.port, 10000);
      console.log('Chrome launched (warm profile kept)');
      return chrome;
    } catch (e) {
      lastErr = e;
      await sleep(2000);
      killChromeOnProfile(profileDir);
    }
  }
  throw lastErr || new Error('Không thể launch Chrome sau 5 lần thử');
}

// Kill any running chrome.exe whose command line references the given profile dir
function killChromeOnProfile(profileDir) {
  try {
    const out = execSync('wmic process where "name=\'chrome.exe\'" get ProcessId,CommandLine /format:list', {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
    });
    const blocks = out.split(/\r?\n\r?\n/);
    for (const block of blocks) {
      if (!block.includes('CommandLine=')) continue;
      if (block.includes(profileDir) && /--headless|--remote-debugging-port/.test(block)) {
        const m = block.match(/ProcessId=(\d+)/);
        if (m) {
          try { execSync(`taskkill /F /PID ${m[1]}`, { windowsHide: true }); } catch (e) {}
        }
      }
    }
  } catch (e) {}
}

// Wait until a TCP port accepts connections (Chrome debug port is up)
function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tryConnect = () => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - t0 > timeoutMs) reject(new Error(`Chrome debug port ${port} không phản hồi`));
        else setTimeout(tryConnect, 400);
      });
    };
    tryConnect();
  });
}

// ──── BLOCK PATTERNS ────
const BLOCK_PATTERNS = [
  'verify you are human', 'are you a robot', 'captcha', 'access denied',
  '403 forbidden', 'blocked', 'security check', 'ddos protection',
  'cloudflare', 'checking your browser', 'enable javascript',
  'please wait while we verify', 'attention required',
  'unusual activity', 'automated access', 'your connection is not private',
  'just a moment', 'waiting for', 'browser check'
];
const HTTP_ERROR_CODES = [403, 404, 500, 502, 503];

// ──── FINGERPRINT SCRIPT (injected on every new page) ────
const FINGERPRINT_SCRIPT = `
// Webdriver flag - critical for stealth when using connect()
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// Hardware
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });

// WebGL vendor
const gp = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(p) {
  if (p === 37445) return 'Intel Inc.';
  if (p === 37446) return 'Intel Iris Xe Graphics';
  return gp.call(this, p);
};
try {
  WebGL2RenderingContext.prototype.getParameter = WebGLRenderingContext.prototype.getParameter;
} catch(e) {}

// Canvas noise (only small canvases used for fingerprinting)
const otd = HTMLCanvasElement.prototype.toDataURL;
HTMLCanvasElement.prototype.toDataURL = function(...a) {
  if (this.width * this.height < 2500) {
    const c = this.getContext('2d');
    if (c) try {
      const d = c.getImageData(0,0,this.width,this.height);
      for (let i=0;i<d.data.length;i+=4) d.data[i] ^= (Math.random()<0.01?1:0);
      c.putImageData(d,0,0);
    } catch(e){}
  }
  return otd.apply(this,a);
};

// Plugin array
Object.defineProperty(navigator, 'plugins', {
  get: () => Object.setPrototypeOf([
    {name:'Chrome PDF Plugin', filename:'internal-pdf-viewer', description:'Portable Document Format'},
    {name:'Chrome PDF Viewer', filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai', description:''},
    {name:'Native Client', filename:'internal-nacl-plugin', description:''}
  ], PluginArray.prototype)
});

// Languages
Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
`;

// ──── USER AGENTS (rotate each run) ────
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
];

// ──── BUTTONS & FIELDS ────
const CART_BUTTONS = ['add to cart', 'add to bag', 'addtocart', 'add-to-cart', 'buy now'];
const CHECKOUT_BUTTONS = ['checkout', 'check out', 'proceed to checkout', 'secure checkout', 'view cart', 'go to cart', 'cart'];
const CONTINUE_BUTTONS = ['continue', 'next', 'proceed', 'save & continue'];
const SUBMIT_BUTTONS = ['place order', 'submit order', 'pay now', 'complete order', 'review order'];
const GUEST_BUTTONS = ['guest', 'checkout as guest', 'continue as guest'];

const FIELD_PATTERNS = {
  firstName:      ['firstname', 'first_name', 'first-name', 'fname', 'given-name', 'first'],
  lastName:       ['lastname', 'last_name', 'last-name', 'lname', 'surname', 'family-name', 'last'],
  fullName:       ['fullname', 'full_name', 'full-name', 'your-name'],
  email:          ['email', 'e-mail', 'mail'],
  phone:          ['phone', 'mobile', 'tel', 'telephone', 'cell'],
  // 'address' only matches exact name="address" (checked in match loop) — NOT address2/address3/finder
  street:         ['street', 'address', 'address1', 'addr1', 'line1', 'address-line1'],
  apt:            ['address2', 'address3', 'apt', 'apartment', 'suite', 'unit', 'line2', 'addr2', 'address-line2', 'address-line3'],
  city:           ['city', 'town', 'locality', 'address-level2'],
  state:          ['state', 'province', 'region', 'address-level1'],
  zipCode:        ['zip', 'zipcode', 'zip-code', 'postal', 'postcode', 'postal-code'],
  country:        ['country', 'nation'],
  cardNumber:     ['cardnumber', 'card_number', 'card-number', 'ccnumber', 'cc-number'],
  cardHolderName: ['cardholder', 'card_holder', 'card-holder', 'cardname', 'name-on-card'],
  cardExpiry:     ['expiry', 'exp', 'expiration', 'expdate', 'exp-date', 'mm/yy'],
  cardExpiryMonth:['exp-month', 'expmonth', 'month', 'mm'],
  cardExpiryYear: ['exp-year', 'expyear', 'year', 'yy'],
  cardCVV:        ['cvv', 'cvc', 'cvv2', 'cvc2', 'csc', 'security', 'verification'],
};

// US state abbreviations → full names (for state dropdown matching)
const US_STATES = { al:'Alabama', ak:'Alaska', az:'Arizona', ar:'Arkansas', ca:'California', co:'Colorado', ct:'Connecticut', de:'Delaware', fl:'Florida', ga:'Georgia', hi:'Hawaii', id:'Idaho', il:'Illinois', in:'Indiana', ia:'Iowa', ks:'Kansas', ky:'Kentucky', la:'Louisiana', me:'Maine', md:'Maryland', ma:'Massachusetts', mi:'Michigan', mn:'Minnesota', ms:'Mississippi', mo:'Missouri', mt:'Montana', ne:'Nebraska', nv:'Nevada', nh:'New Hampshire', nj:'New Jersey', nm:'New Mexico', ny:'New York', nc:'North Carolina', nd:'North Dakota', oh:'Ohio', ok:'Oklahoma', or:'Oregon', pa:'Pennsylvania', ri:'Rhode Island', sc:'South Carolina', sd:'South Dakota', tn:'Tennessee', tx:'Texas', ut:'Utah', vt:'Vermont', va:'Virginia', wa:'Washington', wv:'West Virginia', wi:'Wisconsin', wy:'Wyoming' };

// Razer (Angular Material) uses autocomplete attributes — match these FIRST (most precise)
const AUTOCOMPLETE_MAP = {
  'address-line1': 'street',
  'address-line2': 'apt',
  'address-line3': 'apt',
  'address-level2': 'city',
  'address-level1': 'state',
  'postal-code': 'zipCode',
  'given-name': 'firstName',
  'family-name': 'lastName',
  'email': 'email',
  'tel': 'phone',
};

// ═══════════════════════════════════════════════
// MAIN FLOW
// ═══════════════════════════════════════════════

async function runAutoCheckout(orderData, opts = {}) {
  const { headful = false } = opts;
  const r = initResult();
  const t0 = Date.now();
  let browser = null, chrome = null;

  try {
    const productUrl = orderData.product?.url || orderData.checkout?.url;
    if (!productUrl) return fail('Thiếu product.url hoặc checkout.url');

    // ── LAUNCH REAL CHROME (no Puppeteer) ──
    log(r, '🚀 Khởi động Chrome thật...', 'pending');
    chrome = await launchChromeViaLauncher(headful);
    log(r, `✅ Chrome launched (port ${chrome.port})`, 'done');

    // ── CONNECT Puppeteer to running Chrome ──
    log(r, '🔗 Kết nối Puppeteer...', 'pending');
    browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${chrome.port}`,
      defaultViewport: null,
    });
    log(r, '✅ Connected', 'done');

    // Get or create a page
    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    if (pages.length > 0) {
      // Close blank about:blank page and open fresh
      await page.goto('about:blank');
    }

    // Set UA
    await page.setUserAgent(USER_AGENTS[randInt(0, USER_AGENTS.length - 1)]);
    await page.setViewport({ width: randInt(1366, 1920), height: randInt(720, 1080) });

    // ── INJECT FINGERPRINT SPOOF ──
    await page.evaluateOnNewDocument(FINGERPRINT_SCRIPT);

    // ── WARM-UP: Visit homepage first ──
    const baseUrl = new URL(productUrl).origin;
    log(r, `🔥 Warm-up: ${baseUrl}`, 'pending');
    if (!await gotoVerified(page, baseUrl, r)) return r;
    await randSleep(2500, 1000);
    await humanScroll(page);
    await randSleep(1500, 800);
    log(r, '✅ Warm-up done', 'done');
    await captureSS(r, page, '00_warmup');

    // ── CLEAR STALE CART (persistent profile keeps cart items across runs) ──
    await clearCartAndCheckout(page, r);

    // ── STEP 1: PRODUCT PAGE ──
    log(r, '🛍️ Product page...', 'pending');
    if (!await gotoVerified(page, productUrl, r)) return r;
    log(r, '✅ Loaded', 'done');
    await randSleep(2000, 1000);
    await humanScroll(page);
    await captureSS(r, page, '01_product');

    // ── STEP 2: ADD TO CART ──
    log(r, '🛒 Add to Cart...', 'pending');
    const added = await clickBtn(page, CART_BUTTONS);
    log(r, added ? '✅ Clicked' : '⚠️ Button not found', added ? 'done' : 'warn');
    // Wait for slide-out cart drawer (Razer) or redirect
    await randSleep(4000, 1500);
    
    // Razer uses a slide-out cart drawer — try to click "View Cart" / "Go to Cart" inside it
    // Retry up to 3 times in case drawer hasn't rendered
    for (let attempt = 0; attempt < 3; attempt++) {
      const cartClicked = await clickBtn(page, ['view cart', 'go to cart', 'cart', 'view bag']);
      if (cartClicked) { log(r, '🛒 Clicked View Cart in drawer', 'done'); break; }
      await sleep(1000);
    }
    await randSleep(1500, 800);
    
    // Try guest checkout button if present
    await clickBtn(page, GUEST_BUTTONS);
    await randSleep(1500, 800);
    await captureSS(r, page, '02_added_to_cart');

    // ── STEP 3: GO TO CHECKOUT ──
    log(r, '🛒 Checkout page...', 'pending');
    let found = await clickBtn(page, CHECKOUT_BUTTONS);
    await randSleep(3500, 1000);
    // KEY FIX: Angular often swallows evaluate-clicks — VERIFY the URL actually changed.
    // If not, navigate directly to /checkout instead of trusting the click.
    let cUrl = page.url();
    if (!cUrl.includes('/checkout')) {
      log(r, '⚠️ Click không điều hướng — goto /checkout trực tiếp', 'warn');
      for (const p of ['/checkout', '/checkout/delivery-method', '/checkout/shipping', '/checkout/payment', '/cart']) {
        if (await gotoVerified(page, `${baseUrl}${p}`, r, true)) {
          cUrl = page.url();
          if (cUrl.includes('/checkout')) { found = true; break; }
        }
      }
    }
    await randSleep(2500, 800);
    await humanScroll(page);
    await captureSS(r, page, '03_checkout');
    if (!found) {
      // Still might be on checkout from clicking - check URL
      if (!cUrl.includes('checkout') && !cUrl.includes('cart')) {
        r.success = false;
        r.message = '❌ KHÔNG VÀO ĐƯỢC CHECKOUT. Kiểm tra screenshot.';
        await captureFS(r, page);
        return r;
      }
    }
    log(r, found ? '✅ On checkout' : '⚠️ May not be on checkout', found ? 'done' : 'warn');

    // ── STEP 4: FILL SHIPPING ──
    log(r, '📬 Fill shipping info...', 'pending');
    const checkoutUrl = page.url();
    const formOk = await waitForForm(page, r, checkoutUrl);
    if (!formOk) {
      // Form never rendered → report the REAL cause (anti-bot / Loading shell) instead of a vague "stuck"
      const st = await page.evaluate(() => ({
        loading: /loading/i.test(document.body.innerText || ''),
        inputs: document.querySelectorAll('input:not([type="hidden"]), mat-select').length,
        txt: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 120),
      })).catch(() => ({ loading: false, inputs: 0, txt: '' }));
      r.success = false;
      if (st.loading && st.inputs <= 1) {
        r.message = '❌ FAIL: checkout form không render (kẹt "Loading..." vĩnh viễn) — Razer có thể đang chặn IP/anti-bot. Thử lại sau 5-10 phút hoặc đổi IP/proxy.';
      } else {
        r.message = `❌ FAIL: checkout form không render được (inputs: ${st.inputs}). Kiểm tra screenshot.`;
      }
      r.currentUrl = page.url();
      await captureFS(r, page);
      return r;
    }
    // If sections are collapsed (stale session), expand them via "Edit" buttons
    await expandCollapsedSections(page);
    const s = await autoFill(page, orderData, 'shipping');
    r.filledFields.push(...s.filled);
    r.skippedFields.push(...s.skipped);
    log(r, `✅ Filled ${s.filled.length} fields`, 'done');
    await captureSS(r, page, '04_shipping');

    // Click continue/next — only when ENABLED (Angular keeps it disabled until form valid)
    const cont1 = await clickContinueEnabled(page, r);
    await randSleep(2500, 800);
    await captureSS(r, page, '05_after_continue');

    // ── STEP 4.5: DELIVERY METHOD (Razer step 2 of 3) ──
    if (cont1) {
      const deliveryOk = await handleDeliveryStep(page, r);
      // Always try to continue after the delivery step — even if no radio was found
      // (page may already be on payment, or the radio selector didn't match).
      await clickContinueEnabled(page, r);
      await randSleep(2500, 800);
      await captureSS(r, page, '05b_delivery');
      if (!deliveryOk) log(r, '⚠️ Delivery step: không chọn được radio — vẫn thử continue', 'warn');
    }

    // ── STEP 5: FILL PAYMENT ──
    log(r, '💳 Fill payment info...', 'pending');
    const p = await autoFill(page, orderData, 'payment');
    r.filledFields.push(...p.filled);
    r.skippedFields.push(...p.skipped);
    log(r, `✅ Filled ${p.filled.length} fields`, 'done');
    await captureSS(r, page, '06_payment');
    await randSleep(1500, 500);

    // ── STEP 6: SUBMIT ORDER ──
    log(r, '📤 Submit order...', 'pending');
    const sub = await clickBtn(page, SUBMIT_BUTTONS);
    log(r, sub ? '✅ Submitted' : '⚠️ No submit button found', sub ? 'done' : 'warn');
    await randSleep(6000, 2000);
    await captureSS(r, page, '07_after_submit');

    // ── STEP 7: VERIFY RESULT ──
    log(r, '🔍 Verifying result...', 'pending');
    const curl = page.url();
    
    // Get page text — NOT via safeEval so we can see errors
    let txt = '', title = '';
    try { txt = await page.evaluate(() => document.body.innerText || ''); } catch (e) {}
    try { title = await page.title(); } catch (e) {}

    // Check for block first
    const blocked = detectBlock(txt, title, curl);
    if (blocked) {
      r.success = false;
      r.currentUrl = curl;
      r.message = `🚫 BỊ CHẶN: "${blocked}"`;
      r.steps.push({ step: `🚫 ${blocked}`, status: 'error' });
      await captureFS(r, page);
      return r;
    }
    r.currentUrl = curl;

    // ── DETECT ON-PAGE VALIDATION ERRORS (run FIRST — highest priority) ──
    let validationErrors = '';
    try {
      validationErrors = await page.evaluate(() => {
        // Broad scan for React/MUI/Bootstrap/Tailwind error indicators
        const selectors = [
          '[role="alert"]', '[aria-invalid="true"]',
          '.error', '.invalid', '.has-error', '.is-invalid',
          '[class*="error"]', '[class*="Error"]', '[class*="invalid"]',
          '.text-danger', '.text-error', '.field-error', '.input-error',
          '.form-error', '.validation-error', '.Mui-error', '.MuiFormHelperText-root',
          '[data-error]', '[data-invalid]',
          '.alert-danger', '.alert-error', '.notification-error',
        ];
        const all = Array.from(document.querySelectorAll(selectors.join(',')));
        // Keep only LEAF elements (deepest match) — avoids wrapper divs that mix label + error text
        const leaf = all.filter(el => !all.some(o => o !== el && el.contains(o)));
        // Common phrases that START an error message — cut label/placeholder prefix before them
        const cutKws = ['please ', 'must ', 'cannot ', 'can\'t ', 'is required', 'is not', 'is invalid',
          'is too ', 'less than', 'more than', 'at least', 'maximum', 'does not match', 'not match',
          'incorrect', 'not valid', 'invalid ', 'enter a valid', 'enter your', 'select a', 'choose a',
          'is missing', 'required', 'is empty', 'not be empty'];
        const clean = (t) => {
          const low = t.toLowerCase();
          let idx = -1;
          for (const k of cutKws) {
            const i = low.indexOf(k);
            if (i >= 0 && (idx === -1 || i < idx)) idx = i;
          }
          if (idx > 0) t = t.slice(idx);
          return t.trim();
        };
        return Array.from(new Set(leaf
          .map(e => (e.textContent || '').trim())
          .map(clean)
          .filter(t => t.length > 2 && t.length < 150)))
          .join(' | ');
      });
    } catch (e) {}

    // Also scan the full page text for error keywords
    const txtLower = txt.toLowerCase();
    // Careful: generic words like "select a"/"choose a" appear in normal UI text — only use specific phrases
    const errorKeywords = ['please select a', 'please select your', 'please choose', 'please enter a', 'please enter your',
      'please fill', 'is required', 'field is required', 'this field is required', 'must be', 'cannot be',
      'enter a valid', 'not a valid', 'is invalid', 'is not valid', 'does not match', 'is missing',
      'please provide', 'cannot be empty', 'is required field', 'required field', 'is incorrect',
      'is too long', 'is too short', 'please amend'];
    let foundErrorKeyword = '';
    for (const kw of errorKeywords) {
      if (txtLower.includes(kw)) { foundErrorKeyword = kw; break; }
    }

    // Combine both sources of validation errors
    if (foundErrorKeyword && !validationErrors) {
      // Grab the sentence around the keyword for context
      const i = txtLower.indexOf(foundErrorKeyword);
      const ctx = txt.substring(Math.max(0, i - 60), Math.min(txt.length, i + 120)).replace(/\s+/g, ' ').trim();
      validationErrors = `Page text: "${ctx}"`;
    }

    // ── CHECK IF STILL ON CHECKOUT/CART PAGE ──
    const isCheckout = curl.includes('/checkout') && !curl.includes('success');
    const isCart = curl.includes('/cart') && !curl.includes('checkout');
    const stillOnForm = isCheckout || isCart;

    // Success indicators
    const c = orderData.checkout || {};
    const uK = c.successURLContains || ['thank-you', 'confirmation', 'success', 'complete', 'order-confirmation'];
    const tK = c.successTextContains || ['thank you for your order', 'order confirmed', 'order placed', 'order number:'];

    let ok = false, reason = '';
    for (const kw of uK) {
      if (curl.toLowerCase().includes(kw)) { ok = true; reason = `URL: "${kw}"`; break; }
    }
    // Only check page text if NOT stuck on checkout/cart page
    if (!ok && !stillOnForm) {
      for (const kw of tK) {
        if (txtLower.includes(kw)) { ok = true; reason = `Text: "${kw}"`; break; }
      }
    }

    // ── OVERRIDE: validation errors trump everything ──
    if (ok && validationErrors) {
      ok = false;
    }
    // If stuck on form AND validation errors present → definite FAIL
    if (stillOnForm && validationErrors) {
      ok = false;
    }

    await captureFS(r, page);

    if (ok) {
      r.success = true;
      r.message = `✅ PASS (${reason})`;
    } else {
      if (validationErrors) {
        r.message = `❌ FAIL: validation errors — "${validationErrors.substring(0, 150)}"`;
      } else if (stillOnForm) {
        r.message = `❌ FAIL: stuck on ${isCheckout ? 'checkout' : 'cart'} page — form likely not submitted`;
      } else {
        const errs = ['error', 'failed', 'declined', 'invalid', 'sorry', 'unavailable', 'cannot process'];
        const foundErr = errs.find(e => txtLower.includes(e)) || '';
        r.message = foundErr ? `❌ FAIL: "${foundErr}" detected on page` : '⚠️ UNCERTAIN — check screenshot.';
      }
    }
    log(r, r.message, r.success ? 'done' : 'warn');

  } catch (e) {
    r.success = false;
    r.message = `❌ ERROR: ${e.message}`;
    r.steps.push({ step: `Error: ${e.message}`, status: 'error' });
  } finally {
    if (browser) {
      try { await browser.disconnect(); } catch (e) {}
    }
    if (chrome) {
      try { await chrome.kill(); } catch (e) {}
    }
    r.duration = Date.now() - t0;
  }
  return r;
}

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

function initResult() {
  return {
    success: false,
    message: '',
    timestamp: new Date().toISOString(),
    steps: [],
    stepScreenshots: [],
    finalScreenshot: null,
    duration: 0,
    filledFields: [],
    skippedFields: [],
    currentUrl: '',
  };
}

function fail(msg) {
  const r = initResult();
  r.message = msg;
  return r;
}

function log(r, step, status) {
  r.steps.push({ step, status });
}

async function captureSS(r, page, label) {
  try {
    const s = await page.screenshot({ encoding: 'base64' });
    r.stepScreenshots.push({ label, data: `data:image/png;base64,${s}` });
  } catch (e) {}
}

async function captureFS(r, page) {
  try {
    const s = await page.screenshot({ encoding: 'base64' });
    r.finalScreenshot = `data:image/png;base64,${s}`;
  } catch (e) {}
}

async function humanScroll(page) {
  try {
    await page.evaluate(() => {
      const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
      const max = Math.max(300, document.body.scrollHeight * 0.4);
      window.scrollTo({ top: rand(100, max), behavior: 'smooth' });
    });
  } catch (e) {}
  await sleep(randInt(500, 1500));
}

async function gotoVerified(page, url, r, silentFail = false) {
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    if (resp && HTTP_ERROR_CODES.includes(resp.status())) {
      const msg = `🚫 HTTP ${resp.status()} at ${url}`;
      log(r, msg, 'error');
      if (!silentFail) {
        r.success = false;
        r.message = `🚫 BLOCKED! HTTP ${resp.status()}. Razer từ chối kết nối.`;
      }
      if (!silentFail) await captureFS(r, page);
      return false;
    }
    const txt = await safeEval(page, () => document.body.innerText || '');
    const title = await safeTitle(page);
    const curl = page.url();
    const b = detectBlock(txt, title, curl);
    if (b) {
      if (!silentFail) {
        log(r, `🚫 ${b}`, 'error');
        r.success = false;
        r.message = `🚫 BLOCKED: "${b}"`;
        await captureFS(r, page);
      }
      return false;
    }
    return true;
  } catch (e) {
    // Fallback: try domcontentloaded
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return true;
    } catch (e2) {
      if (!silentFail) {
        log(r, `🚫 Cannot load ${url}: ${e2.message}`, 'error');
        r.success = false;
        r.message = `🚫 KHÔNG THỂ TẢI TRANG: ${e2.message}`;
      }
      if (!silentFail) {
        try { await captureFS(r, page); } catch (e3) {}
      }
      return false;
    }
  }
}

function detectBlock(txt, title, curl) {
  const s = (txt + ' ' + title + ' ' + curl).toLowerCase();
  for (const p of BLOCK_PATTERNS) {
    if (s.includes(p)) return p;
  }
  // Redirected away from razer
  if (curl.startsWith('http') && !curl.includes('razer.com') && !curl.includes('about:blank')) {
    return `redirected to: ${curl}`;
  }
  return null;
}

async function clickBtn(page, keywords) {
  try {
    return await page.evaluate(kws => {
      const btns = Array.from(document.querySelectorAll(
        'button, a, input[type="submit"], input[type="button"], [role="button"], .btn, [type="button"]'
      ));
      let best = null, bp = -1;
      for (const b of btns) {
        if (b.offsetParent === null) continue; // hidden
        const t = (b.textContent || b.value || b.getAttribute('aria-label') || '').toLowerCase().trim();
        if (!t || t.length < 2) continue;
        for (let i = 0; i < kws.length; i++) {
          if (t === kws[i]) { best = b; bp = 1000 - i; break; }
          if (t.includes(kws[i]) && (100 - i) > bp) { best = b; bp = 100 - i; }
        }
      }
      if (best) { best.click(); return true; }
      return false;
    }, keywords);
  } catch (e) {
    return false;
  }
}

// Wait for the checkout form to FULLY render.
// KEY: after SPA-click navigation Razer sometimes renders only the contact inputs but NOT the
// state <mat-select>. A full page reload of /checkout fixes it (renders all 15 fields).
async function waitForForm(page, r, checkoutUrl) {
  const check = async () => {
    return await page.evaluate(() => {
      const inputs = document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], textarea').length;
      const hasSelect = !!document.querySelector('mat-select, select, [role="listbox"], [role="combobox"]');
      return { inputs, hasSelect };
    }).catch(() => ({ inputs: 0, hasSelect: false }));
  };

  // Phase 1: wait up to 12s for the form with a select present
  const t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    const s = await check();
    if (s.hasSelect && s.inputs >= 4) {
      await sleep(1000);
      log(r, '✅ Checkout form rendered (full)', 'done');
      return true;
    }
    await sleep(1200);
  }

  // Phase 2: form incomplete (missing state select) → force full reload of the checkout URL.
  // Try up to 3 reloads — Razer sometimes serves a shell page with "Loading..." that never
  // renders on the first (or second) visit; a reload with the established session often fixes it.
  log(r, '⚠️ Form incomplete (missing select) — reloading checkout...', 'warn');
  if (checkoutUrl && checkoutUrl.includes('/checkout')) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (e) {}
      await sleep(3500);
      const t1 = Date.now();
      while (Date.now() - t1 < 12000) {
        const s = await check();
        if (s.hasSelect && s.inputs >= 4) {
          await sleep(1000);
          log(r, `✅ Checkout form rendered after reload #${attempt + 1}`, 'done');
          return true;
        }
        await sleep(1200);
      }
      log(r, `⚠️ Reload #${attempt + 1} chưa render form — thử lại...`, 'warn');
    }
  }
  log(r, '⚠️ Checkout form still incomplete after reload', 'warn');
  return false;
}

// Persistent profile keeps cart items across runs — clear them via the cart page UI
// so checkout always starts fresh with exactly 1 item. Also dismisses the cookie
// consent banner which otherwise blocks clicks.
async function clearCartAndCheckout(page, r) {
  try {
    const base = new URL(page.url()).origin;
    await page.goto(`${base}/cart`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await sleep(3000);
    // Dismiss cookie banner if present
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button')).filter(b => b.offsetParent !== null);
      const b = btns.find(x => /save my preferences|do not track|accept all/i.test((x.textContent || '').trim()));
      if (b) b.click();
    }).catch(() => {});
    // Click every "Remove item" button
    for (let i = 0; i < 25; i++) {
      const removed = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a, [role="button"], [aria-label]')).filter(b => b.offsetParent !== null);
        const b = btns.find(x => /remove item|remove|delete/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.textContent || '').trim()));
        if (b) { b.click(); return true; }
        return false;
      });
      if (!removed) break;
      await sleep(1200);
    }
    await sleep(1500);
    const items = await page.evaluate(() => {
      const t = (document.body.innerText || '');
      const m = t.match(/(\d+)\s*items? in cart/);
      return m ? parseInt(m[1]) : -1;
    }).catch(() => -1);
    if (items > 0) log(r, `⚠️ Cart còn ${items} items sau khi clear`, 'warn');
    else log(r, '🧹 Cart cleared', 'done');
  } catch (e) {
    log(r, `⚠️ Clear cart failed: ${e.message}`, 'warn');
  }
}

// Click "Continue" only when the button is ENABLED (Angular/disabled buttons swallow clicks)
// Retries up to ~25s because Razer enables the button once client-side validation passes
async function clickContinueEnabled(page, r) {
  const kws = ['continue to payment', 'continue', 'next', 'proceed', 'save & continue', 'save and continue'];
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const res = await page.evaluate(kws2 => {
      const btns = Array.from(document.querySelectorAll(
        'button, a, input[type="submit"], input[type="button"], [role="button"], .btn'
      ));
      let best = null, bp = -1;
      for (const b of btns) {
        if (b.offsetParent === null) continue;
        const t = (b.textContent || b.value || b.getAttribute('aria-label') || '').toLowerCase().trim();
        if (!t || t.length < 2) continue;
        for (let i = 0; i < kws2.length; i++) {
          if (t.includes(kws2[i]) && (100 - i) > bp) { best = b; bp = 100 - i; }
        }
      }
      if (!best) return { found: false };
      const disabled = best.disabled || best.getAttribute('aria-disabled') === 'true'
        || /button-inactive|button_inactive|disabled/i.test((best.className || '').toString());
      return { found: true, disabled, text: (best.textContent || '').trim().slice(0, 40) };
    }, kws);
    if (!res.found) return false;
    if (!res.disabled) {
      // Click the enabled button via real mouse click (Angular listens to real events)
      const sel = await bestBtnSelector(page, res.text);
      if (sel) { try { await page.click(sel, { timeout: 3000 }); } catch (e) {} }
      // Also force evaluate click as backup
      await page.evaluate(kws3 => {
        const btns = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"], [role="button"], .btn'));
        const b = btns.find(x => {
          if (x.offsetParent === null) return false;
          const t = (x.textContent || x.value || x.getAttribute('aria-label') || '').toLowerCase().trim();
          return kws3.some(k => t.includes(k));
        });
        if (b) b.click();
      }, kws);
      log(r, `✅ Clicked "${res.text}"`, 'done');
      return true;
    }
    await sleep(1200); // button still disabled — wait for validation to pass
  }
  log(r, '⚠️ Continue button stayed disabled — form likely has validation errors', 'warn');
  return false;
}

// If the checkout page shows collapsed/summary sections ("Edit" buttons) instead of form fields,
// click Edit to re-open the forms. Stale sessions / previously-filled profiles cause this.
async function expandCollapsedSections(page) {
  try {
    for (let i = 0; i < 3; i++) {
      const fieldCount = await page.evaluate(() =>
        document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], mat-select, select').length
      );
      if (fieldCount >= 4) return; // form already expanded
      const clicked = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const b = btns.find(x => x.offsetParent !== null && /^\s*edit\s*$/i.test((x.textContent || '').trim()));
        if (b) { b.click(); return true; }
        return false;
      });
      if (!clicked) return;
      await sleep(1500);
    }
  } catch (e) {}
}

// Razer step 2: choose a delivery method (radio group), returns true if a radio was selected
async function handleDeliveryStep(page, r) {
  try {
    await page.waitForSelector('input[type="radio"]', { timeout: 12000 });
    await sleep(1200);
  } catch (e) {
    return false; // no radio group → no delivery step (not Razer-style)
  }
  // Find the standard-shipping radio: prefer id/name/aria-label with "standard",
  // then "free"/"economy", then the surrounding text ("Standard Shipping").
  const targets = await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll('input[type="radio"]'))
      .filter(x => x.offsetParent !== null);
    if (!radios.length) return [];
    const score = (x) => {
      const hay = (x.id + ' ' + x.name + ' ' + (x.getAttribute('aria-label') || '')).toLowerCase();
      const ctx = ((x.closest('label') || x.parentElement || {}).textContent || '').toLowerCase();
      let s = 0;
      if (/standard/.test(hay)) s += 100;
      if (/standard shipping/.test(ctx)) s += 80;
      if (/free|economy|ground/.test(hay)) s += 50;
      if (/express|priority|overnight|2-?day|next ?day/.test(hay)) s -= 100;
      if (/express|priority|overnight/.test(ctx)) s -= 50;
      return s;
    };
    return radios
      .map(x => {
        const r = x.getBoundingClientRect();
        const label = x.closest('label') || x.parentElement;
        const lr = label ? label.getBoundingClientRect() : r;
        return {
          id: x.id || x.name || 'radio',
          score: score(x),
          // clickable point = label centre (Angular Material radios need label click)
          x: Math.round(lr.x + lr.width / 2),
          y: Math.round(lr.y + lr.height / 2),
        };
      })
      .sort((a, b) => b.score - a.score);
  }).catch(() => []);

  if (!targets.length) {
    log(r, '⚠️ No delivery radio found', 'warn');
    return false;
  }

  // Real mouse click (Angular registers real events; JS label.click() often does NOT)
  const best = targets[0];
  try {
    await page.mouse.click(best.x, best.y);
  } catch (e) {
    // Fallback: evaluate click on the label
    await page.evaluate((id) => {
      const r = Array.from(document.querySelectorAll('input[type="radio"]')).find(x => (x.id || x.name) === id);
      if (!r) return;
      const label = r.closest('label') || r.parentElement;
      if (label) label.click(); else r.click();
    }, best.id).catch(() => {});
  }
  await sleep(1200);

  // Verify the radio actually got checked; retry once on the next-best option
  let checked = await page.evaluate((id) => {
    const r = Array.from(document.querySelectorAll('input[type="radio"]')).find(x => (x.id || x.name) === id);
    return r ? !!r.checked : false;
  }, best.id).catch(() => false);

  if (!checked && targets.length > 1) {
    log(r, '⚠️ Standard radio chưa được check — thử option kế tiếp', 'warn');
    try {
      await page.mouse.click(targets[1].x, targets[1].y);
    } catch (e) {}
    await sleep(1200);
    checked = await page.evaluate((id) => {
      const r = Array.from(document.querySelectorAll('input[type="radio"]')).find(x => (x.id || x.name) === id);
      return r ? !!r.checked : false;
    }, targets[1].id).catch(() => false);
  }

  if (checked) {
    log(r, `✅ Delivery method selected: ${best.id}`, 'done');
    await sleep(1500);
    return true;
  }
  log(r, `⚠️ Không verify được radio checked (${best.id})`, 'warn');
  return false;
}

// Helper: find a selector for the enabled continue button (best-effort, used for real CDP click)
async function bestBtnSelector(page, text) {
  try {
    const sel = await page.evaluate(t => {
      const btns = Array.from(document.querySelectorAll('button, a, [role="button"], .btn'));
      const b = btns.find(x => {
        if (x.offsetParent === null) return false;
        return ((x.textContent || '').toLowerCase().trim().includes(t.toLowerCase()) && !x.disabled);
      });
      if (!b) return null;
      if (b.id) return `#${CSS.escape(b.id)}`;
      if (b.getAttribute('data-testid')) return `[data-testid="${b.getAttribute('data-testid')}"]`;
      if (b.className) {
        const cls = (b.className + '').split(/\s+/).filter(c => c.length > 3 && !/button-inactive/.test(c));
        return cls[0] ? `.${cls[0]}` : null;
      }
      return null;
    }, text);
    return sel || null;
  } catch (e) { return null; }
}

async function autoFill(page, orderData, section) {
  const filled = [], skipped = [];

  // Gather fields — use direct page.evaluate (NOT safeEval) so errors surface
  // Retry scan up to 3x: Angular renders fields lazily, some appear after others
  let fields = [];
  let scanErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fields = await page.evaluate(() => {
      const f = [];
      document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea, [role="combobox"], [role="listbox"], mat-select').forEach(el => {
        // Skip truly hidden elements EXCEPT native <select> (Razer hides them behind custom widgets)
        if (el.offsetParent === null && el.tagName.toLowerCase() !== 'select') return;
        // Skip disabled
        if (el.disabled || el.readOnly) return;
        // Skip address autocomplete "finder" inputs (Razer) — these are search-as-you-type widgets, not real fields
        if ((el.id && el.id.toLowerCase().includes('finder')) || (el.className && String(el.className).toLowerCase().includes('finder'))) return;
        const a = {
          id: (el.id || '').toLowerCase(),
          name: (el.name || '').toLowerCase(),
          placeholder: (el.placeholder || '').toLowerCase(),
          className: (el.className || '').toLowerCase(),
          type: (el.type || el.tagName).toLowerCase(),
          tag: el.tagName.toLowerCase(),
          role: (el.getAttribute('role') || '').toLowerCase(),
          autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
          // Capture maxlength so we truncate values BEFORE setting (native setter bypasses maxlength)
          maxlength: (el.maxLength && el.maxLength > 0 && el.maxLength < 100000) ? el.maxLength : null,
          labelText: '',
        };
        // Find label
        if (el.id) {
          const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (l) a.labelText = (l.textContent || '').toLowerCase();
        }
        if (!a.labelText) {
          const pl = el.closest('label');
          if (pl) a.labelText = (pl.textContent || '').toLowerCase();
        }
        if (!a.labelText && el.previousElementSibling && el.previousElementSibling.tagName === 'LABEL') {
          a.labelText = (el.previousElementSibling.textContent || '').toLowerCase();
        }
        // Also check parent text content for wrapped inputs (common in Razer/React forms)
        if (!a.labelText && el.parentElement) {
          const parentText = (el.parentElement.textContent || '').toLowerCase().trim();
          if (parentText.length < 60) a.labelText = parentText;
        }
        // Build selector
        if (el.id) a.selector = `#${CSS.escape(el.id)}`;
        else if (el.name) a.selector = `[name="${CSS.escape(el.name)}"]`;
        else a.selector = null;
        f.push(a);
      });
      return f;
    });
      // Enough fields? If we have 0, wait and rescan (lazy render)
      if (fields.length > 0) break;
      scanErr = 'No fields found on attempt ' + (attempt + 1);
      await sleep(2000);
    } catch (e) {
      scanErr = e.message;
      await sleep(1500);
    }
  }
  if (!fields || fields.length === 0) {
    return { filled: [], skipped: [{ field: 'SCAN_ERROR', reason: scanErr || 'No fields' }] };
  }

  // Build value map
  const map = {};
  if (section && orderData[section]) {
    Object.assign(map, orderData[section]);
    // Always include customer data
    if (section !== 'customer' && orderData.customer) {
      Object.assign(map, orderData.customer);
    }
  } else {
    ['customer', 'shipping', 'payment'].forEach(s => {
      if (orderData[s]) Object.assign(map, orderData[s]);
    });
  }

  for (const f of fields) {
    const searchText = [f.id, f.name, f.placeholder, f.labelText, f.className, f.autocomplete].join(' ');
    let matched = false;

    // PRIORITY 1: exact autocomplete attribute (Razer Angular Material sets these precisely)
    for (const [acPat, key] of Object.entries(AUTOCOMPLETE_MAP)) {
      if (matched) break;
      if (f.autocomplete.includes(acPat)) {
        const val = map[key];
        if (!val) {
          skipped.push({ field: key, reason: 'No value' });
          matched = true;
          break;
        }
        const sel = f.selector || (f.id ? `#${f.id}` : null);
        if (!sel) { skipped.push({ field: key, reason: 'No selector' }); matched = true; break; }
        try {
          if (f.type === 'radio' || f.type === 'checkbox') {
            await page.click(sel);
          } else {
            let fillVal = String(val);
            if (f.maxlength && fillVal.length > f.maxlength) fillVal = fillVal.slice(0, f.maxlength);
            await fillSmart(page, sel, fillVal, f.tag, f.role, f.maxlength);
          }
          filled.push({ field: key, value: String(val), selector: sel });
          matched = true;
        } catch (e) {
          skipped.push({ field: key, reason: e.message });
          matched = true;
        }
        break;
      }
    }

    // PRIORITY 2: FIELD_PATTERNS scan
    for (const [key, patterns] of Object.entries(FIELD_PATTERNS)) {
      if (matched) break;
      for (const pat of patterns) {
        // 'address' pattern only matches exact name="address" (line 1), not address2/address3/finder
        if (pat === 'address' && f.name !== 'address') continue;
        if (searchText.includes(pat)) {
          const val = map[key];
          if (!val) {
            skipped.push({ field: key, reason: 'No value' });
            matched = true;
            break;
          }

          let sel = f.selector;
          if (!sel) {
            if (f.id) sel = `#${f.id.replace(/[!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~]/g, '\\$&')}`;
            else if (f.name) sel = `[name="${f.name.replace(/"/g, '\\"')}"]`;
            else {
              skipped.push({ field: key, reason: 'No selector' });
              matched = true;
              break;
            }
          }

          try {
            if (f.type === 'radio' || f.type === 'checkbox') {
              await page.click(sel);
            } else {
              // Truncate to field maxlength (e.g. Razer Address Line 2 = 10 chars)
              let fillVal = String(val);
              if (f.maxlength && fillVal.length > f.maxlength) {
                fillVal = fillVal.slice(0, f.maxlength);
              }
              await fillSmart(page, sel, fillVal, f.tag, f.role, f.maxlength);
            }
            filled.push({ field: key, value: String(val), selector: sel });
            matched = true;
          } catch (e) {
            skipped.push({ field: key, reason: e.message });
            matched = true;
          }
          break;
        }
      }
    }
    if (!matched) {
      skipped.push({ field: 'unknown', reason: `No pattern match: ${f.id || f.name || '?'}` });
    }
  }

  return { filled, skipped };
}

async function fillSmart(page, sel, val, tag, role, maxlength) {
  await page.waitForSelector(sel, { timeout: 5000 }).catch(() => {});
  // Belt-and-braces: truncate again inside in case caller forgot
  if (maxlength && val.length > maxlength) val = val.slice(0, maxlength);

  const isCombobox = role && /combobox|listbox|dropdown|option/i.test(role);
  const isMatSelect = tag === 'mat-select' || (sel && /mat-select/i.test(sel));
  
  if (isMatSelect) {
    // ── ANGULAR MATERIAL <mat-select>: click to open overlay, then pick <mat-option> ──
    // Try up to 3 times: panels sometimes render lazily or the click needs a second attempt.
    let picked = null;
    for (let attempt = 0; attempt < 3 && !picked; attempt++) {
      await page.click(sel).catch(() => {});
      // Wait for the cdk overlay panel to actually render options (virtual scroll = lazy)
      try {
        await page.waitForFunction(
          () => document.querySelectorAll('mat-option:not(.mat-mdc-option-disabled)').length > 0,
          { timeout: 4000 }
        );
      } catch (e) {}
      await sleep(600);
      picked = await page.evaluate(v => {
        const US = { al:'Alabama', ak:'Alaska', az:'Arizona', ar:'Arkansas', ca:'California', co:'Colorado', ct:'Connecticut', de:'Delaware', fl:'Florida', ga:'Georgia', hi:'Hawaii', id:'Idaho', il:'Illinois', in:'Indiana', ia:'Iowa', ks:'Kansas', ky:'Kentucky', la:'Louisiana', me:'Maine', md:'Maryland', ma:'Massachusetts', mi:'Michigan', mn:'Minnesota', ms:'Mississippi', mo:'Missouri', mt:'Montana', ne:'Nebraska', nv:'Nevada', nh:'New Hampshire', nj:'New Jersey', nm:'New Mexico', ny:'New York', nc:'North Carolina', nd:'North Dakota', oh:'Ohio', ok:'Oklahoma', or:'Oregon', pa:'Pennsylvania', ri:'Rhode Island', sc:'South Carolina', sd:'South Dakota', tn:'Tennessee', tx:'Texas', ut:'Utah', vt:'Vermont', va:'Virginia', wa:'Washington', wv:'West Virginia', wi:'Wisconsin', wy:'Wyoming' };
        const vL = v.toLowerCase();
        const opts = Array.from(document.querySelectorAll('mat-option:not(.mat-mdc-option-disabled)'));
        const found = opts.find(o => {
          const t = (o.textContent || '').toLowerCase().trim();
          const val = (o.getAttribute('value') || '').toLowerCase();
          if (t === vL || val === vL) return true;
          if (t.startsWith(vL)) return true;
          if (vL.length === 2) {
            if (val.startsWith(vL)) return true;
            if (t.split(/\s+/).some(w => w.startsWith(vL))) return true;
            const full = US[vL];
            if (full && (t === full.toLowerCase() || t.startsWith(full.toLowerCase()))) return true;
          }
          return false;
        });
        if (found) {
          // Real click on the option row (not the checkbox/icon inside)
          (found.querySelector('.mdc-list-item__primary-text') || found).click();
          return (found.textContent || '').trim().slice(0, 40);
        }
        // Fallback: type-ahead. Angular Material selects support keyboard search —
        // type the first letters of the state name to jump to it (handles virtual scroll).
        return null;
      }, val);
      if (!picked) {
        // Keyboard type-ahead in the OPEN panel: type the state name slowly.
        // This highlights the matching option even if it's below the virtual-scroll fold.
        await page.keyboard.type(String(val).slice(0, 4), { delay: 150 });
        await sleep(500);
        await page.keyboard.press('Enter');
        await sleep(400);
        // Check if selection stuck
        const stuck = await page.evaluate(() => {
          const m = document.querySelector('mat-select');
          return m ? (m.textContent || '').trim().slice(0, 30) : '';
        }).catch(() => '');
        if (stuck && /select/i.test(stuck) && !/new york/i.test(stuck)) {
          await page.keyboard.press('Escape');
          await sleep(400);
        } else {
          picked = stuck || 'typeahead'; // assume success if the label changed away from placeholder
          if (/select/i.test(picked)) picked = null; // still showing placeholder → failed
        }
      }
      if (!picked) {
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(400);
      }
    }
    await sleep(300);
    
  } else if (tag === 'select') {
    // Native <select>: use native value setter + events (works for most frameworks)
    await page.evaluate((s, v) => {
      const US = { al:'Alabama', ak:'Alaska', az:'Arizona', ar:'Arkansas', ca:'California', co:'Colorado', ct:'Connecticut', de:'Delaware', fl:'Florida', ga:'Georgia', hi:'Hawaii', id:'Idaho', il:'Illinois', in:'Indiana', ia:'Iowa', ks:'Kansas', ky:'Kentucky', la:'Louisiana', me:'Maine', md:'Maryland', ma:'Massachusetts', mi:'Michigan', mn:'Minnesota', ms:'Mississippi', mo:'Missouri', mt:'Montana', ne:'Nebraska', nv:'Nevada', nh:'New Hampshire', nj:'New Jersey', nm:'New Mexico', ny:'New York', nc:'North Carolina', nd:'North Dakota', oh:'Ohio', ok:'Oklahoma', or:'Oregon', pa:'Pennsylvania', ri:'Rhode Island', sc:'South Carolina', sd:'South Dakota', tn:'Tennessee', tx:'Texas', ut:'Utah', vt:'Vermont', va:'Virginia', wa:'Washington', wv:'West Virginia', wi:'Wisconsin', wy:'Wyoming' };
      const el = document.querySelector(s);
      if (!el || !el.options) return;
      const vL = v.toLowerCase();
      
      // Match: exact value > exact text > starts-with > abbreviation + US state name
      const opt = Array.from(el.options).find(o => {
        const oVal = o.value.toLowerCase();
        const oText = o.text.toLowerCase().trim();
        if (oVal === vL) return true;
        if (oText === vL) return true;
        if (oText.startsWith(vL)) return true;
        if (vL.length === 2) {
          if (oVal.startsWith(vL)) return true;
          if (oText.split(/\s+/).some(w => w.startsWith(vL))) return true;
          const full = US[vL];
          if (full && (oText === full.toLowerCase() || oText.startsWith(full.toLowerCase()))) return true;
        }
        return false;
      });
      if (!opt) return;
      
      // Native value setter (works for React + vanilla + most frameworks)
      const desc = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el), 'value'
      );
      if (desc && desc.set) desc.set.call(el, opt.value);
      else el.value = opt.value;
      
      // Dispatch events in correct order
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, sel, val);
    
  } else if (isCombobox || tag === 'input') {
    // Input / Combobox: focus, clear, type with React-compatible setter
    await page.focus(sel).catch(() => {});
    await sleep(50);
    
    // Triple-click to select all, then type to replace
    await page.click(sel, { clickCount: 3 }).catch(() => {});
    await sleep(50);
    
    // Use React-compatible native value setter + typing
    await page.evaluate((s, v) => {
      const el = document.querySelector(s);
      if (!el) return;
      
      // React-compatible native value setter
      const desc = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(el), 'value'
      );
      if (desc && desc.set) desc.set.call(el, v);
      else el.value = v;
      
      // Dispatch events
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, sel, val);
    
    // For comboboxes, also press ArrowDown + Enter to select from dropdown
    if (isCombobox) {
      await sleep(200);
      await page.keyboard.press('ArrowDown');
      await sleep(100);
      await page.keyboard.press('Enter');
    }
    
    // Trigger blur (important for React validation)
    await sleep(100);
    await page.evaluate(s => {
      const el = document.querySelector(s);
      if (el) el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, sel);
    
    await page.keyboard.press('Tab');
    await sleep(50);
    
  } else {
    // Fallback for other elements (textarea, div, etc.)
    await page.focus(sel).catch(() => {});
    await page.click(sel, { clickCount: 3 }).catch(() => {});
    await sleep(50);
    for (const ch of val) {
      await page.keyboard.type(ch, { delay: randInt(40, 120) });
    }
    await page.keyboard.press('Tab');
    await page.evaluate(s => {
      const el = document.querySelector(s);
      if (el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      }
    }, sel);
  }
}

async function safeEval(page, fn) {
  try { return await page.evaluate(fn); }
  catch (e) { return ''; }
}

async function safeTitle(page) {
  try { return await page.title(); }
  catch (e) { return ''; }
}

// ──── DETECT FORM FIELDS (utility) ────
async function detectFormFields(url) {
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--no-sandbox', '--headless=new', '--window-size=1366,768'],
    ignoreDefaultFlags: true,
    userDataDir: undefined, // no persistent profile for field detection
  });
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(3000);
    const fields = await page.evaluate(() => {
      const r = [];
      document.querySelectorAll('input:not([type="hidden"]), select, textarea').forEach(el => {
        if (el.offsetParent === null) return;
        let lt = '';
        if (el.id) {
          const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
          if (l) lt = l.textContent?.trim() || '';
        }
        if (!lt) {
          const pl = el.closest('label');
          if (pl) lt = pl.textContent?.trim() || '';
        }
        r.push({
          selector: el.id ? `#${CSS.escape(el.id)}` : (el.name ? `[name="${CSS.escape(el.name)}"]` : null),
          tag: el.tagName.toLowerCase(),
          type: el.type || '',
          id: el.id || '',
          name: el.name || '',
          placeholder: el.placeholder || '',
          label: lt,
          autocomplete: el.getAttribute('autocomplete') || '',
          className: el.className || '',
        });
      });
      return r;
    });
    await browser.disconnect();
    await chrome.kill();
    return fields;
  } catch (e) {
    await browser.disconnect();
    await chrome.kill();
    throw e;
  }
}

module.exports = { runAutoCheckout, detectFormFields };
