/**
 * 💳 Payment Checker Server
 * Auto checkout tool - kiểm tra hệ thống thanh toán tự động
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const { runAutoCheckout, detectFormFields } = require('./src/checker');
const { loadScenarios, addScenario, updateScenario, deleteScenario, saveResult, getResults } = require('./src/config');
const { getCardByType } = require('./src/testData');
const { convertRawToOrderData } = require('./src/converter');

const app = express();
const PORT = process.env.PORT || 3456;

const ORDER_DATA_PATH = path.join(__dirname, 'config', 'order-data.json');

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ──────────────────────────────────────
// ORDER DATA FILE API
// ──────────────────────────────────────

// Get current order data
app.get('/api/order-data', (req, res) => {
  try {
    if (!fs.existsSync(ORDER_DATA_PATH)) {
      return res.json({ success: true, data: null, message: 'Chưa có file order-data.json' });
    }
    const data = JSON.parse(fs.readFileSync(ORDER_DATA_PATH, 'utf-8'));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Save/Update order data
app.put('/api/order-data', (req, res) => {
  try {
    fs.writeFileSync(ORDER_DATA_PATH, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true, message: 'Đã lưu order-data.json' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────
// CHECKOUT API
// ──────────────────────────────────────

// Run auto checkout using order-data.json
app.post('/api/checkout', async (req, res) => {
  try {
    let orderData;

    if (req.body && req.body.checkout) {
      // Use data sent from client
      orderData = req.body;
    } else if (fs.existsSync(ORDER_DATA_PATH)) {
      // Use saved order-data.json
      orderData = JSON.parse(fs.readFileSync(ORDER_DATA_PATH, 'utf-8'));
    } else {
      return res.status(400).json({ 
        success: false, 
        error: 'Chưa có dữ liệu đơn hàng. Vui lòng tạo order-data.json hoặc gửi dữ liệu trong request.' 
      });
    }

    const targetUrl = orderData.product?.url || orderData.checkout?.url;
    if (!targetUrl) {
      return res.status(400).json({ success: false, error: 'Thiếu product.url hoặc checkout.url trong dữ liệu đơn hàng' });
    }

    const headful = req.query.headful === 'true' || req.body.headful === true;

    console.log(`🚀 Running checkout: ${targetUrl}${headful ? ' [HEADFUL]' : ''}`);
    const result = await runAutoCheckout(orderData, { headful });

    // Save result (strip screenshots for disk)
    const resultForDisk = { ...result };
    delete resultForDisk.stepScreenshots;
    delete resultForDisk.finalScreenshot;
    const orderName = orderData.customer?.fullName || 'order';
    saveResult(orderName, resultForDisk);

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run a single payment check (backward compat — dùng cho tab Scenarios)
app.post('/api/check', async (req, res) => {
  try {
    const scenario = req.body;
    if (!scenario.url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }
    // Convert scenario to order-data format cho runAutoCheckout
    let orderData;
    if (fs.existsSync(ORDER_DATA_PATH)) {
      orderData = JSON.parse(fs.readFileSync(ORDER_DATA_PATH, 'utf-8'));
      orderData.checkout = { ...orderData.checkout, url: scenario.url };
      if (scenario.successIndicator) {
        orderData.checkout.successURLContains = scenario.successIndicator.urlContains || orderData.checkout.successURLContains;
        orderData.checkout.successTextContains = scenario.successIndicator.textContains || orderData.checkout.successTextContains;
      }
      if (scenario.cardType) {
        const card = getCardByType(scenario.cardType);
        orderData.payment = {
          cardNumber: card.number,
          cardHolderName: card.name,
          cardExpiry: card.expiry,
          cardCVV: card.cvv
        };
      }
    } else {
      orderData = { checkout: { url: scenario.url } };
    }

    const result = await runAutoCheckout(orderData);
    saveResult(scenario.name || 'scenario', result);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run all enabled scenarios
app.post('/api/check-all', async (req, res) => {
  try {
    const scenarios = loadScenarios().filter(s => s.enabled !== false);
    if (scenarios.length === 0) {
      return res.status(400).json({ success: false, error: 'No enabled scenarios' });
    }
    // Read order data once, outside the loop
    let baseOrderData = null;
    if (fs.existsSync(ORDER_DATA_PATH)) {
      baseOrderData = JSON.parse(fs.readFileSync(ORDER_DATA_PATH, 'utf-8'));
    }
    const results = [];
    for (const scenario of scenarios) {
      const orderData = baseOrderData
        ? { ...baseOrderData, checkout: { ...baseOrderData.checkout, url: scenario.url } }
        : { checkout: { url: scenario.url } };
      const result = await runAutoCheckout(orderData);
      saveResult(scenario.name, result);
      results.push({ scenarioName: scenario.name, success: result.success, message: result.message, duration: result.duration });
    }
    const passed = results.filter(r => r.success).length;
    res.json({ success: true, summary: { total: results.length, passed, failed: results.length - passed, passRate: Math.round((passed / results.length) * 100) }, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Run checkout with custom URL only
app.post('/api/checkout-quick', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });

    let orderData;
    if (fs.existsSync(ORDER_DATA_PATH)) {
      orderData = JSON.parse(fs.readFileSync(ORDER_DATA_PATH, 'utf-8'));
      orderData.checkout = { ...orderData.checkout, url };
    } else {
      orderData = { checkout: { url } };
    }

    const result = await runAutoCheckout(orderData);
    saveResult('quick-checkout', result);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────
// SMART CONVERTER API
// ──────────────────────────────────────

app.post('/api/convert', (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, error: 'Vui lòng nhập dữ liệu để chuyển đổi' });
    }
    const orderData = convertRawToOrderData(text);
    if (!orderData) {
      return res.status(400).json({ success: false, error: 'Không thể parse dữ liệu. Thử dùng format khác.' });
    }
    
    // Also return details about what was detected
    const detected = {};
    if (Object.keys(orderData.customer || {}).length) detected.customer = orderData.customer;
    if (Object.keys(orderData.shipping || {}).length) detected.shipping = orderData.shipping;
    if (Object.keys(orderData.payment || {}).length) detected.payment = orderData.payment;
    if (orderData.products?.length) detected.products = orderData.products;
    
    res.json({ 
      success: true, 
      data: orderData,
      summary: {
        format: Object.keys(detected).join(', ') || 'basic',
        fieldsDetected: Object.keys(orderData.customer || {}).length + 
                       Object.keys(orderData.shipping || {}).length + 
                       Object.keys(orderData.payment || {}).length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────
// FORM DETECTION API
// ──────────────────────────────────────

app.post('/api/detect-fields', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL is required' });
    const fields = await detectFormFields(url);
    res.json({ success: true, data: fields });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────
// SCENARIOS API (backward compat)
// ──────────────────────────────────────

app.get('/api/scenarios', (req, res) => {
  try {
    const scenarios = loadScenarios();
    res.json({ success: true, data: scenarios });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/scenarios', (req, res) => {
  try {
    const scenario = addScenario(req.body);
    res.json({ success: true, data: scenario });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/scenarios/:id', (req, res) => {
  try {
    const scenario = updateScenario(req.params.id, req.body);
    if (!scenario) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: scenario });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/scenarios/:id', (req, res) => {
  try {
    const deleted = deleteScenario(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────
// HISTORY API
// ──────────────────────────────────────

app.get('/api/history', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const results = getResults(limit);
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────
// HEALTH CHECK
// ──────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'running',
    orderDataExists: fs.existsSync(ORDER_DATA_PATH),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ──────────────────────────────────────
// START
// ──────────────────────────────────────

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║         💳 AUTO ORDER CHECKER                ║');
  console.log('║                                              ║');
  console.log(`║  Server: http://localhost:${PORT}                ║`);
  console.log('║  Order data: config/order-data.json          ║');
  console.log('║  Nhấn Ctrl+C để dừng                         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
