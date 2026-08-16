/**
 * RAZER ORDER CHECKER - Frontend
 * Single product, single site — ultra simple
 */
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  checkServerHealth();
  loadHistory();
});

function initNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabName = item.dataset.tab;
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.getElementById(`tab-${tabName}`).classList.add('active');
      if (tabName === 'history') loadHistory();
      if (tabName === 'batch') parseBatch();
    });
  });
}

async function checkServerHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const dot = document.querySelector('.status-dot');
    const text = document.querySelector('.status-text');
    if (data.success) {
      dot.classList.add('online'); dot.classList.remove('offline');
      text.textContent = 'Server online';
    } else {
      dot.classList.add('offline');
      text.textContent = 'Server error';
    }
  } catch (e) {
    document.querySelector('.status-dot').classList.add('offline');
    document.querySelector('.status-text').textContent = 'Server offline';
  }
}

// ──── GATHER DATA FROM FORM ────
function gatherOrderData() {
  return {
    product: {
      name: "Razer Gigantus V2 Pro",
      url: "https://www.razer.com/gaming-mouse-mats/razer-gigantus-v2-pro/RZ02-05490600-R3U1",
      sku: "RZ02-05490600-R3U1",
      quantity: 1,
      price: 99.99
    },
    checkout: {
      steps: ["product", "cart", "shipping", "payment"],
      successURLContains: ["checkout/success", "order-confirmation", "thank-you", "order/success", "success", "complete"],
      successTextContains: ["thank you for your order", "order confirmed", "order number:", "order placed", "confirmation"]
    },
    customer: {
      fullName: `${document.getElementById('cFirstName').value} ${document.getElementById('cLastName').value}`.trim(),
      firstName: document.getElementById('cFirstName').value,
      lastName: document.getElementById('cLastName').value,
      email: document.getElementById('cEmail').value,
      phone: document.getElementById('cPhone').value
    },
    shipping: {
      street: document.getElementById('sStreet').value,
      apt: document.getElementById('sApt').value,
      city: document.getElementById('sCity').value,
      state: document.getElementById('sState').value,
      zipCode: document.getElementById('sZip').value,
      country: document.getElementById('sCountry').value
    },
    payment: {
      cardNumber: document.getElementById('pCardNumber').value,
      cardHolderName: document.getElementById('pCardName').value,
      cardExpiryMonth: document.getElementById('pExpMonth').value,
      cardExpiryYear: document.getElementById('pExpYear').value,
      cardExpiry: `${document.getElementById('pExpMonth').value}/${document.getElementById('pExpYear').value.slice(-2)}`,
      cardCVV: document.getElementById('pCvv').value
    }
  };
}

// ──── RUN FULL CHECKOUT ────
async function runFullCheckout() {
  const btn = document.getElementById('btnRun');
  const resultDiv = document.getElementById('runResult');
  const orderData = gatherOrderData();
  const headful = document.getElementById('chkHeadful')?.checked || false;
  if (headful) orderData.headful = true;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Đang chạy...';
  resultDiv.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>Đang tự động test checkout Razer...</p>
      <p style="font-size:0.8rem;color:var(--text-muted);">Product → Add to Cart → Checkout → Fill → Submit → Result</p>
    </div>
  `;

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    const json = await res.json();

    if (json.success) {
      renderResult(json.data, resultDiv);
      loadHistory();
    } else {
      resultDiv.innerHTML = `<div class="status-banner danger">
        <span class="banner-icon">❌</span>
        <div class="banner-content"><div class="banner-title">Lỗi</div><div class="banner-detail">${json.error || json.message}</div></div>
      </div>`;
    }
  } catch (e) {
    resultDiv.innerHTML = `<div class="status-banner danger">
      <span class="banner-icon">❌</span>
      <div class="banner-content"><div class="banner-title">Lỗi kết nối</div><div class="banner-detail">${e.message}</div></div>
    </div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-icon">▶️</span> Chạy Test Đơn Hàng Razer';
  }
}

function renderResult(result, container) {
  const statusClass = result.success ? 'success' : 'danger';
  const statusIcon = result.success ? '✅' : '❌';

  let stepsHtml = '';
  if (result.steps) {
    stepsHtml = '<ul class="steps-list">';
    result.steps.forEach(s => {
      let icon = '⏳', iconClass = '';
      if (s.status === 'done') { icon = '✅'; iconClass = 'done'; }
      else if (s.status === 'error') { icon = '❌'; iconClass = 'error'; }
      else if (s.status === 'warn') { icon = '⚠️'; iconClass = 'error'; }
      else if (s.status === 'pending' || s.status === 'running') { icon = '🔄'; iconClass = 'running'; }
      stepsHtml += `<li><span class="step-icon ${iconClass}">${icon}</span> ${s.step}</li>`;
    });
    stepsHtml += '</ul>';
  }

  let filledHtml = '';
  if (result.filledFields && result.filledFields.length > 0) {
    filledHtml = `<p style="margin-top:12px;font-size:0.82rem;color:var(--text-secondary);">
      📝 <strong>Đã fill ${result.filledFields.length} field:</strong> ${result.filledFields.map(f => f.field).join(', ')}
    </p>`;
  }

  // Step screenshots (new!)
  let stepScreenshotsHtml = '';
  const screenshots = result.stepScreenshots || [];
  if (screenshots.length > 0) {
    stepScreenshotsHtml = '<div style="margin-top:16px;"><strong style="font-size:0.82rem;color:var(--text-secondary);">📸 Screenshots từng bước:</strong><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:8px;margin-top:8px;">';
    screenshots.slice(-4).forEach(s => {
      stepScreenshotsHtml += `<div class="screenshot-preview" style="margin:0;"><div style="font-size:0.7rem;padding:4px 8px;background:var(--bg-hover);color:var(--text-muted);">${s.label}</div><img src="${s.data}" style="width:100%;" /></div>`;
    });
    stepScreenshotsHtml += '</div></div>';
  }

  // Final screenshot
  let screenshotHtml = '';
  const finalSs = result.finalScreenshot || result.screenshot;
  if (finalSs) {
    screenshotHtml = `<div class="screenshot-preview"><img src="${finalSs}" alt="Final Screenshot" /></div>`;
  }

  container.innerHTML = `
    <div class="status-banner ${statusClass}">
      <span class="banner-icon">${statusIcon}</span>
      <div class="banner-content">
        <div class="banner-title">${result.message}</div>
        <div class="banner-detail">⏱️ ${(result.duration / 1000).toFixed(2)}s | 🕐 ${new Date(result.timestamp).toLocaleTimeString('vi-VN')}</div>
      </div>
    </div>
    ${stepsHtml}
    ${filledHtml}
    ${stepScreenshotsHtml}
    ${screenshotHtml}
  `;
}

// ──── HISTORY ────
async function loadHistory() {
  const list = document.getElementById('historyList');
  try {
    const res = await fetch('/api/history');
    const json = await res.json();
    if (json.success && json.data.length > 0) {
      list.innerHTML = json.data.slice(0, 20).map(r => `
        <div class="history-item">
          <div class="history-status ${r.success ? 'pass' : 'fail'}"></div>
          <div class="history-name">${r.scenario || r.filename}</div>
          <div class="history-time">${new Date(r.timestamp).toLocaleString('vi-VN')}</div>
          <div class="history-duration">${(r.duration / 1000).toFixed(1)}s</div>
          <span class="badge ${r.success ? 'badge-pass' : 'badge-fail'}">${r.success ? '✅ PASS' : '❌ FAIL'}</span>
        </div>
      `).join('');
    } else {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📜</div><div class="empty-title">Chưa có lịch sử</div><div class="empty-desc">Chạy test đầu tiên!</div></div>';
    }
  } catch (e) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">❌</div><div class="empty-title">Lỗi tải lịch sử</div></div>';
  }
}

// ──── BATCH TEST ────
let batchCases = [];
let batchRunning = false;

function parseBatch() {
  const raw = document.getElementById('batchInput').value.trim();
  if (!raw) { showToast('error', '❌ Vui lòng paste dữ liệu'); return; }

  const lines = raw.split('\n').filter(l => l.trim());
  batchCases = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split('|').map(p => p.trim());
    // Format: CARD|MM|YY|CVV|NAME|STREET|CITY|STATE|ZIP|EXTRA|
    if (parts.length < 8) continue;

    const cardNumber = parts[0];
    const expMonth = parts[1].padStart(2, '0');
    const expYear = '20' + parts[2];
    const cvv = parts[3];
    const fullName = parts[4];
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';
    const street = parts[5];
    const city = parts[6];
    const state = parts[7];
    const zip = parts[8] || '';

    batchCases.push({
      index: i + 1,
      fullName,
      firstName,
      lastName,
      cardNumber,
      expMonth,
      expYear,
      cvv,
      street,
      city,
      state,
      zip
    });
  }

  // Show parsed result
  const resultDiv = document.getElementById('batchParseResult');
  if (batchCases.length === 0) {
    resultDiv.innerHTML = '<div class="status-banner warning"><span class="banner-icon">⚠️</span><div class="banner-content"><div class="banner-title">Không parse được dòng nào</div><div class="banner-detail">Kiểm tra format: CARD|MM|YY|CVV|NAME|STREET|CITY|STATE|ZIP|</div></div></div>';
  } else {
    resultDiv.innerHTML = `
      <div class="status-banner info">
        <span class="banner-icon">📊</span>
        <div class="banner-content">
          <div class="banner-title">Đã parse ${batchCases.length} test cases</div>
          <div class="banner-detail">Sẵn sàng chạy batch test</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px;">
        ${batchCases.map(c => `<span style="font-size:0.75rem;background:var(--bg-input);padding:4px 10px;border-radius:20px;border:1px solid var(--border);">#${c.index} ${c.fullName}</span>`).join('')}
      </div>
    `;
  }

  document.getElementById('btnBatchRun').disabled = batchCases.length === 0;
}

async function runBatch() {
  if (batchCases.length === 0) { parseBatch(); if (batchCases.length === 0) return; }
  if (batchRunning) return;

  batchRunning = true;
  const btn = document.getElementById('btnBatchRun');
  const stopBtn = document.getElementById('btnBatchStop');
  const resultCard = document.getElementById('batchResultCard');
  const tbody = document.getElementById('batchTbody');
  const summary = document.getElementById('batchSummary');

  btn.style.display = 'none';
  stopBtn.style.display = 'inline-flex';
  resultCard.style.display = 'block';

  // Init table
  tbody.innerHTML = batchCases.map(c => `
    <tr id="batchRow${c.index}" style="border-bottom:1px solid var(--border);">
      <td style="padding:10px 14px;">#${c.index}</td>
      <td style="padding:10px 14px;">${c.fullName}</td>
      <td style="padding:10px 14px;font-family:monospace;font-size:0.75rem;">${c.cardNumber.slice(-4)}</td>
      <td style="padding:10px 14px;">${c.city}</td>
      <td style="padding:10px 14px;" id="batchStatus${c.index}">⏳</td>
      <td style="padding:10px 14px;" id="batchTime${c.index}">--</td>
    </tr>
  `).join('');

  let passed = 0;
  let failed = 0;

  // Run sequentially with abort support
  for (const c of batchCases) {
    if (!batchRunning) { tbody.innerHTML += '<tr><td colspan="6" style="padding:12px;text-align:center;color:var(--warning);">⏹️ Batch đã bị dừng</td></tr>'; break; }

    // Highlight current row
    const row = document.getElementById(`batchRow${c.index}`);
    if (row) row.style.background = 'var(--accent-glow)';
    document.getElementById(`batchStatus${c.index}`).innerHTML = '▶️ <span class="spinner"></span>';

    const orderData = buildBatchOrderData(c);

    try {
      // Timeout after 90 seconds
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const json = await res.json();

      const statusEl = document.getElementById(`batchStatus${c.index}`);
      const timeEl = document.getElementById(`batchTime${c.index}`);

      if (json.success && json.data) {
        const r = json.data;
        if (r.success) {
          statusEl.innerHTML = '<span class="badge badge-pass">✅ PASS</span>';
          passed++;
        } else {
          statusEl.innerHTML = '<span class="badge badge-fail">❌ FAIL</span>';
          failed++;
        }
        timeEl.textContent = `${(r.duration / 1000).toFixed(1)}s`;
      } else {
        statusEl.innerHTML = '<span class="badge badge-fail">❌ ERR</span>';
        timeEl.textContent = '--';
        failed++;
      }
    } catch (e) {
      const statusEl = document.getElementById(`batchStatus${c.index}`);
      if (statusEl) {
        statusEl.innerHTML = e.name === 'AbortError'
          ? '<span class="badge badge-fail">⏰ TIMEOUT</span>'
          : '<span class="badge badge-fail">❌ ERR</span>';
      }
      document.getElementById(`batchTime${c.index}`).textContent = e.name === 'AbortError' ? '90s+' : '--';
      failed++;
    }

    // Remove highlight
    if (row) row.style.background = '';

    // Update summary live
    summary.innerHTML = `${passed + failed}/${batchCases.length} | ✅ ${passed} | ❌ ${failed}`;
  }

  if (batchRunning) {
    batchRunning = false;
    btn.style.display = 'inline-flex';
    btn.innerHTML = '<span>▶️</span> Chạy Tất Cả Test Cases';
    stopBtn.style.display = 'none';
    summary.innerHTML = `✅ ${passed} Pass | ❌ ${failed} Fail | 📊 ${batchCases.length} Total`;
    showToast('success', `🏁 Hoàn thành ${batchCases.length} cases: ${passed} pass, ${failed} fail`);
  } else {
    btn.style.display = 'inline-flex';
    btn.innerHTML = '<span>▶️</span> Chạy Tất Cả Test Cases';
    stopBtn.style.display = 'none';
  }
  loadHistory();
}

function stopBatch() {
  batchRunning = false;
  document.getElementById('btnBatchStop').style.display = 'none';
  document.getElementById('btnBatchRun').style.display = 'inline-flex';
  document.getElementById('btnBatchRun').innerHTML = '<span>▶️</span> Chạy Tất Cả Test Cases';
  showToast('info', '⏹️ Đã dừng batch test');
}

function buildBatchOrderData(c) {
  return {
    product: {
      name: "Razer Gigantus V2 Pro",
      url: "https://www.razer.com/gaming-mouse-mats/razer-gigantus-v2-pro/RZ02-05490600-R3U1",
      sku: "RZ02-05490600-R3U1",
      quantity: 1,
      price: 99.99
    },
    checkout: {
      steps: ["product", "cart", "shipping", "payment"],
      successURLContains: ["checkout/success", "order-confirmation", "thank-you", "order/success", "success", "complete"],
      successTextContains: ["thank you for your order", "order confirmed", "order number:", "order placed", "confirmation"]
    },
    customer: {
      fullName: c.fullName,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.fullName.toLowerCase().replace(/\s+/g, '.') + '@test.com',
      phone: '2125551234'
    },
    shipping: {
      street: c.street,
      city: c.city,
      state: c.state,
      zipCode: c.zip,
      country: ['Singapore','SG','SGP'].includes(c.state) ? 'SG' : (c.state === 'CA' || c.state === 'NY' || c.state === 'GA' || c.state === 'TX' || c.state === 'FL' ? 'US' : 'US')
    },
    payment: {
      cardNumber: c.cardNumber,
      cardHolderName: c.fullName.toUpperCase(),
      cardExpiryMonth: c.expMonth,
      cardExpiryYear: c.expYear,
      cardExpiry: `${c.expMonth}/${c.expYear.slice(-2)}`,
      cardCVV: c.cvv
    }
  };
}

function showToast(type, message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'all 0.3s'; setTimeout(() => toast.remove(), 300); }, 3000);
}
