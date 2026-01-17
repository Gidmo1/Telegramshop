// app.js (Orderlyy Dashboard)
// Tabs: Overview, Products, Orders, Payments, Settings
// - Analytics (Chart.js) + KPIs
// - Products CRUD (uses /api/products)
// - Orders status updates (uses /api/orders/:id/status)
// - Payments review (list + proof preview + approve/reject via /api/payments/:id/(approve|reject))
// - Settings: bank details save (/api/store/bank)
// - Subscription banner + gating (worker returns subscription_* + support_link)

(() => {
  const $ = (id) => document.getElementById(id);

  // Sections
  const loginSection = $('login');
  const appSection = $('app');

  // Auth UI
  const tokenInput = $('tokenInput');
  const loginBtn = $('loginBtn');
  const logoutBtn = $('logoutBtn');

  // Tabs
  const tabButtons = Array.from(document.querySelectorAll('.tabBtn'));
  const tabPanels = {
    overview: $('tab-overview'),
    products: $('tab-products'),
    orders: $('tab-orders'),
    payments: $('tab-payments'),
    settings: $('tab-settings'),
  };

  // Subscription banner (optional in index.html)
  const subBanner = $('subBanner');
  const subBannerText = $('subBannerText');
  const subBannerBtn = $('subBannerBtn');

  // Overview / Analytics
  const storeInfo = $('storeInfo');
  const periodSelect = $('periodSelect');
  const analyticsMsg = $('analyticsMsg');

  const kpiOrders = $('kpiOrders');
  const kpiOrdersDelta = $('kpiOrdersDelta');
  const kpiRevenue = $('kpiRevenue');
  const kpiRevenueDelta = $('kpiRevenueDelta');
  const kpiPending = $('kpiPending');
  const kpiPendingDelta = $('kpiPendingDelta');
  const kpiProducts = $('kpiProducts');
  const kpiProductsDelta = $('kpiProductsDelta');

  const ordersChartCanvas = $('ordersChart');
  let ordersChart = null;

  // Products
  const refreshProductsBtn = $('refreshProducts');
  const productForm = $('productForm');
  const clearFormBtn = $('clearForm');
  const productFormMsg = $('productFormMsg');
  const productsTable = $('productsTable');
  const productsTbody = productsTable ? productsTable.querySelector('tbody') : null;

  // Orders
  const refreshOrdersBtn = $('refreshOrders');
  const ordersTable = $('ordersTable');
  const ordersTbody = ordersTable ? ordersTable.querySelector('tbody') : null;

  // Payments
  const refreshPaymentsBtn = $('refreshPayments');
  const paymentsStatusFilter = $('paymentsStatusFilter');
  const paymentsTable = $('paymentsTable');
  const paymentsTbody = paymentsTable ? paymentsTable.querySelector('tbody') : null;

  // Payment modal (optional)
  const payModal = $('payModal');
  const payModalClose = $('payModalClose');
  const payModalTitle = $('payModalTitle');
  const payModalBody = $('payModalBody');

  // Settings (Bank)
  const bankForm = $('bankForm');
  const bankMsg = $('bankMsg');
  const bankNameInput = $('bankName');
  const accountNumberInput = $('accountNumber');
  const accountNameInput = $('accountName');

  // Token storage
  const TOKEN_KEY = 'orderlyy_token';

  // Cached data
  let cachedStore = null;
  let cachedProducts = [];
  let cachedOrders = [];
  let cachedPayments = [];

  // ---------- Token helpers ----------
  function getTokenFromUrl() {
    try {
      const url = new URL(location.href);
      return (url.searchParams.get('token') || '').trim();
    } catch {
      return '';
    }
  }
  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }
  function getToken() {
    return (localStorage.getItem(TOKEN_KEY) || '').trim();
  }
  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }
  function setInputValueSafe(el, value) {
    if (!el) return;
    el.value = value;
  }

  // ---------- API ----------
  async function api(path, { method = 'GET', body } = {}) {
    const token = getToken();
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;

    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const msg = data.error || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  function formatMoney(currency, value) {
    if (value === null || value === undefined) return '—';
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    const cur = currency || '';
    return `${cur}${num}`;
  }

  // ---------- Tabs ----------
  function setActiveTab(tabName) {
    tabButtons.forEach((b) => b.classList.toggle('active', b.dataset.tab === tabName));
    Object.entries(tabPanels).forEach(([name, el]) => {
      if (!el) return;
      el.hidden = name !== tabName;
    });
  }

  // ---------- UI show/hide ----------
  function showApp() {
    if (loginSection) loginSection.hidden = true;
    if (appSection) appSection.hidden = false;
    if (logoutBtn) logoutBtn.hidden = false;
  }
  function showLogin() {
    if (loginSection) loginSection.hidden = false;
    if (appSection) appSection.hidden = true;
    if (logoutBtn) logoutBtn.hidden = true;
  }

  // ---------- HTML escaping ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // ---------- Subscription / gating ----------
  function isSubActive(store) {
    // worker returns subscription_active boolean
    return !!store?.subscription_active;
  }

  function setWriteLockUI(locked, store) {
    // Disable forms/buttons (products add/edit, bank save, payment approve/reject, order status changes)
    const lockables = [
      productForm,
      refreshProductsBtn,
      refreshOrdersBtn,
      refreshPaymentsBtn,
      bankForm,
    ];

    lockables.forEach((el) => {
      if (!el) return;
      // For form, disable its inputs
      if (el.tagName === 'FORM') {
        el.querySelectorAll('input, textarea, select, button').forEach((x) => (x.disabled = !!locked));
      } else if ('disabled' in el) {
        el.disabled = !!locked;
      }
    });

    // Table action buttons will be re-rendered; we also guard in handlers.
    renderSubscriptionBanner(store);
  }

  function renderSubscriptionBanner(store) {
    if (!subBanner || !subBannerText) return;

    const active = isSubActive(store);
    const exp = store?.subscription_expires_at ? `Expiry: ${store.subscription_expires_at}` : '';
    const support = store?.support_link || (store?.support_username ? `https://t.me/${String(store.support_username).replace(/^@/, '')}` : '');

    if (active) {
      subBanner.hidden = true;
      return;
    }

    subBanner.hidden = false;
    subBannerText.innerHTML = `
      <b>🔒 Subscription inactive/expired</b><br/>
      ${exp ? `<span class="muted">${escapeHtml(exp)}</span><br/>` : ''}
      <span class="muted">Contact support to activate.</span>
    `;

    if (subBannerBtn) {
      subBannerBtn.onclick = () => {
        if (support) window.open(support, '_blank');
      };
    }
  }

  function guardWrite(store) {
    if (!store) return true;
    if (isSubActive(store)) return true;
    const support = store?.support_link || '';
    alert('Subscription inactive/expired. Please contact support to activate.');
    if (support) window.open(support, '_blank');
    return false;
  }

  // ---------- Store ----------
  async function loadStore() {
    const out = await api('/api/store');
    const store = out.store;
    cachedStore = store;

    // Render store info block
    if (storeInfo) {
      storeInfo.innerHTML = `
        <div><b>Name:</b> ${escapeHtml(store.name)}</div>
        <div><b>Currency:</b> ${escapeHtml(store.currency)}</div>
        <div><b>Channel:</b> ${
          store.channel_username
            ? '@' + escapeHtml(store.channel_username)
            : (store.channel_id ? escapeHtml(store.channel_id) : '<span class="muted">Not linked</span>')
        }</div>
        <div><b>Delivery note:</b> ${escapeHtml(store.delivery_note || '')}</div>
        <hr />
        <div><b>Subscription:</b> ${store.subscription_active ? '<span class="badge good">Active</span>' : '<span class="badge bad">Inactive</span>'}</div>
        <div class="small muted">${store.subscription_expires_at ? `Expiry: ${escapeHtml(store.subscription_expires_at)}` : ''}</div>
      `;
    }

    // Fill bank form defaults (Settings tab)
    if (bankNameInput) bankNameInput.value = store.bank_name || '';
    if (accountNumberInput) accountNumberInput.value = store.account_number || '';
    if (accountNameInput) accountNameInput.value = store.account_name || '';

    // Apply lock UI
    setWriteLockUI(!isSubActive(store), store);

    return store;
  }

  // ---------- Products ----------
  async function loadProducts() {
    cachedProducts = (await api('/api/products')).products || [];
    renderProducts();
    return cachedProducts;
  }

  function renderProducts() {
    if (!productsTbody || !cachedStore) return;
    productsTbody.innerHTML = '';

    for (const p of cachedProducts) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.name)}</td>
        <td>${escapeHtml(formatMoney(cachedStore.currency, p.price))}</td>
        <td>${p.in_stock ? '<span class="badge good">In stock</span>' : '<span class="badge bad">Out</span>'}</td>
        <td class="muted">${p.photo_file_id ? '<code>' + escapeHtml(p.photo_file_id) + '</code>' : ''}</td>
        <td>
          <button class="btn secondary smallBtn" data-act="toggle" data-id="${escapeAttr(p.id)}">Toggle</button>
          <button class="btn secondary smallBtn" data-act="edit" data-id="${escapeAttr(p.id)}">Edit</button>
        </td>
      `;
      productsTbody.appendChild(tr);
    }

    productsTbody.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!guardWrite(cachedStore)) return;
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');

        try {
          if (act === 'toggle') {
            await toggleStock(id);
            await loadProducts();
            await loadAnalyticsSafe();
          } else if (act === 'edit') {
            await editProduct(id);
            await loadProducts();
            await loadAnalyticsSafe();
          }
        } catch (e) {
          alert(e.message);
        }
      });
    });

    setKpiValue(kpiProducts, cachedProducts.length);
  }

  async function toggleStock(id) {
    const product = cachedProducts.find((p) => p.id === id);
    if (!product) throw new Error('Product not found');
    const newStock = product.in_stock ? 0 : 1;

    await api(`/api/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: {
        name: product.name,
        price: product.price,
        description: product.description || '',
        in_stock: newStock,
        photo_file_id: product.photo_file_id || null,
      },
    });
  }

  async function editProduct(id) {
    const product = cachedProducts.find((p) => p.id === id);
    if (!product) throw new Error('Product not found');

    const name = prompt('Product name', product.name);
    if (name === null) return;

    const priceStr = prompt('Price (number)', String(product.price));
    if (priceStr === null) return;
    const price = Number(priceStr);
    if (!Number.isFinite(price) || price < 0) throw new Error('Invalid price');

    const description = prompt('Description', product.description || '') ?? '';
    const inStock = confirm('In stock? (OK=yes, Cancel=no)') ? 1 : 0;
    const photo_file_id = prompt('Photo file_id (optional)', product.photo_file_id || '') ?? '';

    await api(`/api/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: {
        name: name.trim(),
        price,
        description,
        in_stock: inStock,
        photo_file_id: photo_file_id.trim() || null,
      },
    });
  }

  async function addProductFromForm() {
    if (!productForm || !productFormMsg) return;
    if (!guardWrite(cachedStore)) return;

    productFormMsg.textContent = '';

    const formData = new FormData(productForm);
    const name = String(formData.get('name') || '').trim();
    const price = Number(formData.get('price') || 0);
    const description = String(formData.get('description') || '').trim();
    const in_stock = String(formData.get('in_stock') || '1') === '1' ? 1 : 0;
    const photo_file_id = String(formData.get('photo_file_id') || '').trim() || null;

    if (!name || !Number.isFinite(price)) {
      productFormMsg.textContent = 'Name and numeric price are required.';
      return;
    }

    await api('/api/products', {
      method: 'POST',
      body: { name, price, description, in_stock, photo_file_id },
    });

    productForm.reset();
    const stockSel = productForm.querySelector('select[name="in_stock"]');
    if (stockSel) stockSel.value = '1';
    productFormMsg.textContent = 'Product added ✅';

    await loadProducts();
    await loadAnalyticsSafe();
  }

  // ---------- Orders ----------
  async function loadOrders() {
    cachedOrders = (await api('/api/orders')).orders || [];
    renderOrders();
    return cachedOrders;
  }

  function renderOrders() {
    if (!ordersTbody) return;
    ordersTbody.innerHTML = '';

    for (const o of cachedOrders) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${escapeHtml(o.id)}</code></td>
        <td>${escapeHtml(o.product_name || '')}</td>
        <td>${o.buyer_username ? '@' + escapeHtml(o.buyer_username) : '<span class="muted">(unknown)</span>'}</td>
        <td>${escapeHtml(String(o.qty))}</td>
        <td>${escapeHtml(o.status || '')}</td>
        <td class="muted small">${o.delivery_text ? escapeHtml(o.delivery_text) : ''}</td>
        <td>
          <button class="btn secondary smallBtn" data-act="done" data-id="${escapeAttr(o.id)}">Done</button>
          <button class="btn secondary smallBtn" data-act="pending" data-id="${escapeAttr(o.id)}">Pending</button>
        </td>
      `;
      ordersTbody.appendChild(tr);
    }

    ordersTbody.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!guardWrite(cachedStore)) return;
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');
        try {
          const status = act === 'done' ? 'done' : 'pending';
          await api(`/api/orders/${encodeURIComponent(id)}/status`, { method: 'PUT', body: { status } });
          await loadOrders();
          await loadAnalyticsSafe();
        } catch (e) {
          alert(e.message);
        }
      });
    });

    const pendingCount = cachedOrders.filter((o) => o.status === 'pending').length;
    setKpiValue(kpiPending, pendingCount);
  }

  // ---------- Payments ----------
  async function loadPayments() {
    const status = paymentsStatusFilter ? paymentsStatusFilter.value : '';
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    cachedPayments = (await api(`/api/payments${qs}`)).payments || [];
    renderPayments();
    return cachedPayments;
  }

  function paymentStatusBadge(s) {
    const v = String(s || '').toLowerCase();
    if (v === 'confirmed') return `<span class="badge good">Confirmed</span>`;
    if (v === 'awaiting') return `<span class="badge warn">Awaiting</span>`;
    if (v === 'rejected') return `<span class="badge bad">Rejected</span>`;
    return `<span class="badge">${escapeHtml(v || '—')}</span>`;
  }

  function openPaymentModal(paymentId) {
    if (!payModal || !payModalBody || !payModalTitle) {
      // fallback: open proof in new tab
      window.open(`/api/payments/${encodeURIComponent(paymentId)}/proof`, '_blank');
      return;
    }

    const p = cachedPayments.find(x => x.id === paymentId);
    payModalTitle.textContent = `Payment ${paymentId.slice(0, 8)}…`;
    const proofUrl = `/api/payments/${encodeURIComponent(paymentId)}/proof`;

    payModalBody.innerHTML = `
      <div class="payModalGrid">
        <div>
          <div class="muted small">Product</div>
          <div><b>${escapeHtml(p?.product_name || '')}</b></div>
          <div class="muted small" style="margin-top:8px;">Amount</div>
          <div><b>${escapeHtml(formatMoney(p?.currency || '', p?.amount || 0))}</b></div>
          <div class="muted small" style="margin-top:8px;">Buyer</div>
          <div>${p?.buyer_username ? '@' + escapeHtml(p.buyer_username) : '<span class="muted">(unknown)</span>'}</div>
          <div class="muted small" style="margin-top:8px;">Order</div>
          <div><code>${escapeHtml(p?.order_id || '')}</code></div>
          <div class="muted small" style="margin-top:8px;">Status</div>
          <div>${paymentStatusBadge(p?.status)}</div>
          <div class="muted small" style="margin-top:8px;">Delivery details</div>
          <div class="small">${p?.delivery_text ? escapeHtml(p.delivery_text) : '<span class="muted">—</span>'}</div>

          <div class="row" style="margin-top:14px; gap:8px;">
            <button class="btn" id="pmApprove">Approve</button>
            <button class="btn secondary" id="pmReject">Reject</button>
            <button class="btn secondary" id="pmOpenProof">Open proof</button>
          </div>
        </div>

        <div class="proofPane">
          <div class="muted small">Proof preview</div>
          <img class="proofImg" src="${proofUrl}" alt="Proof" />
        </div>
      </div>
    `;

    payModal.hidden = false;

    const approveBtn = $('pmApprove');
    const rejectBtn = $('pmReject');
    const openBtn = $('pmOpenProof');

    if (approveBtn) approveBtn.onclick = () => approvePayment(paymentId).catch(e => alert(e.message));
    if (rejectBtn) rejectBtn.onclick = () => rejectPayment(paymentId).catch(e => alert(e.message));
    if (openBtn) openBtn.onclick = () => window.open(proofUrl, '_blank');
  }

  async function approvePayment(paymentId) {
    if (!guardWrite(cachedStore)) return;
    await api(`/api/payments/${encodeURIComponent(paymentId)}/approve`, { method: 'PUT' });
    await loadPayments();
    await loadOrders();
    alert('Approved ✅ Buyer will be asked for delivery details.');
    closePaymentModal();
  }

  async function rejectPayment(paymentId) {
    if (!guardWrite(cachedStore)) return;
    await api(`/api/payments/${encodeURIComponent(paymentId)}/reject`, { method: 'PUT' });
    await loadPayments();
    await loadOrders();
    alert('Rejected ❌ Buyer will be notified.');
    closePaymentModal();
  }

  function closePaymentModal() {
    if (!payModal) return;
    payModal.hidden = true;
    if (payModalBody) payModalBody.innerHTML = '';
  }

  function renderPayments() {
    if (!paymentsTbody) return;
    paymentsTbody.innerHTML = '';

    for (const p of cachedPayments) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><code>${escapeHtml(p.id)}</code></td>
        <td><code>${escapeHtml(p.order_id || '')}</code></td>
        <td>${escapeHtml(p.product_name || '')}</td>
        <td>${p.buyer_username ? '@' + escapeHtml(p.buyer_username) : '<span class="muted">(unknown)</span>'}</td>
        <td><b>${escapeHtml(formatMoney(p.currency || (cachedStore?.currency || ''), p.amount || 0))}</b></td>
        <td>${paymentStatusBadge(p.status)}</td>
        <td class="row" style="gap:8px;">
          <button class="btn secondary smallBtn" data-act="view" data-id="${escapeAttr(p.id)}">View</button>
          <button class="btn smallBtn" data-act="approve" data-id="${escapeAttr(p.id)}">Approve</button>
          <button class="btn secondary smallBtn" data-act="reject" data-id="${escapeAttr(p.id)}">Reject</button>
        </td>
      `;
      paymentsTbody.appendChild(tr);
    }

    paymentsTbody.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');

        try {
          if (act === 'view') {
            openPaymentModal(id);
            return;
          }
          if (!guardWrite(cachedStore)) return;
          if (act === 'approve') await approvePayment(id);
          if (act === 'reject') await rejectPayment(id);
        } catch (e) {
          alert(e.message);
        }
      });
    });
  }

  // ---------- Settings (bank) ----------
  async function saveBankDetails() {
    if (!bankForm || !bankMsg) return;
    if (!guardWrite(cachedStore)) return;

    bankMsg.textContent = '';

    const bank_name = (bankNameInput?.value || '').trim();
    const account_number = (accountNumberInput?.value || '').trim();
    const account_name = (accountNameInput?.value || '').trim();

    if (!bank_name || !account_number || !account_name) {
      bankMsg.textContent = 'All fields are required.';
      return;
    }

    await api('/api/store/bank', { method: 'PUT', body: { bank_name, account_number, account_name } });
    bankMsg.textContent = 'Saved ✅';
    await loadStore();
  }

  // ---------- Analytics ----------
  function setKpiValue(el, val) {
    if (!el) return;
    el.textContent = String(val);
  }

  function setDelta(el, pct) {
    if (!el) return;

    if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) {
      el.className = 'kpiDelta muted deltaFlat';
      el.innerHTML = '—';
      return;
    }

    const n = Number(pct);
    const abs = Math.abs(n).toFixed(1);

    if (n > 0) {
      el.className = 'kpiDelta deltaUp';
      el.innerHTML = `<span class="tri up"></span><span>+${abs}%</span>`;
    } else if (n < 0) {
      el.className = 'kpiDelta deltaDown';
      el.innerHTML = `<span class="tri down"></span><span>-${abs}%</span>`;
    } else {
      el.className = 'kpiDelta muted deltaFlat';
      el.innerHTML = `<span>0.0%</span>`;
    }
  }

  function buildChart(labels, values) {
    if (!ordersChartCanvas || typeof Chart === 'undefined') return;

    const data = {
      labels,
      datasets: [{
        label: 'Orders',
        data: values,
        tension: 0.35,
        borderWidth: 2,
        pointRadius: 2,
      }],
    };

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#a7b0c0' }, grid: { color: 'rgba(31,42,64,0.35)' } },
        y: { ticks: { color: '#a7b0c0', precision: 0 }, grid: { color: 'rgba(31,42,64,0.35)' } },
      },
    };

    if (!ordersChart) {
      ordersChart = new Chart(ordersChartCanvas.getContext('2d'), { type: 'line', data, options });
    } else {
      ordersChart.data = data;
      ordersChart.update();
    }
  }

  async function loadAnalyticsSafe() {
    if (!cachedStore) return;

    const period = periodSelect ? periodSelect.value : '30d';

    try {
      const out = await api(`/api/analytics?period=${encodeURIComponent(period)}`);
      const a = out.analytics || out;

      setKpiValue(kpiOrders, a.orders_total ?? cachedOrders.length);
      setDelta(kpiOrdersDelta, a.orders_change_pct);

      setKpiValue(kpiRevenue, a.revenue_total ?? 0);
      setDelta(kpiRevenueDelta, a.revenue_change_pct);

      const pendingFallback = cachedOrders.filter((o) => o.status === 'pending').length;
      setKpiValue(kpiPending, a.pending_total ?? pendingFallback);
      setDelta(kpiPendingDelta, a.pending_change_pct);

      setKpiValue(kpiProducts, a.products_total ?? cachedProducts.length);
      setDelta(kpiProductsDelta, a.products_change_pct);

      const labels = a.series?.labels || [];
      const values = a.series?.values || [];
      if (labels.length && values.length) buildChart(labels, values);

      if (analyticsMsg) analyticsMsg.textContent = '';
    } catch (e) {
      const pending = cachedOrders.filter((o) => o.status === 'pending').length;
      setKpiValue(kpiOrders, cachedOrders.length);
      setDelta(kpiOrdersDelta, null);

      setKpiValue(kpiRevenue, 0);
      setDelta(kpiRevenueDelta, null);

      setKpiValue(kpiPending, pending);
      setDelta(kpiPendingDelta, null);

      setKpiValue(kpiProducts, cachedProducts.length);
      setDelta(kpiProductsDelta, null);

      if (analyticsMsg) analyticsMsg.textContent = `Analytics not ready (${e.message})`;
    }
  }

  // ---------- Load all ----------
  async function loadAll() {
    await loadStore();
    await Promise.all([loadProducts(), loadOrders(), loadPayments()]);
    await loadAnalyticsSafe();
  }

  // ---------- Login ----------
  async function doLogin(token) {
    if (!token) throw new Error('Missing token');
    setToken(token);
    showApp();
    setActiveTab('overview');
    await loadAll();
  }

  // ---------- Wiring ----------
  function wireEvents() {
    // Tabs
    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
    });

    // Login
    if (loginBtn) {
      loginBtn.addEventListener('click', async () => {
        const token = tokenInput ? tokenInput.value.trim() : '';
        if (!token) return;
        try {
          await doLogin(token);
        } catch (e) {
          clearToken();
          alert('Login failed: ' + e.message);
          showLogin();
        }
      });
    }

    // Logout
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        clearToken();
        location.href = location.pathname;
      });
    }

    // Products
    if (refreshProductsBtn) refreshProductsBtn.addEventListener('click', () => loadProducts().catch((e) => alert(e.message)));
    if (productForm) {
      productForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        addProductFromForm().catch((e) => {
          if (productFormMsg) productFormMsg.textContent = 'Error: ' + e.message;
          alert(e.message);
        });
      });
    }
    if (clearFormBtn && productForm) {
      clearFormBtn.addEventListener('click', () => {
        productForm.reset();
        const stockSel = productForm.querySelector('select[name="in_stock"]');
        if (stockSel) stockSel.value = '1';
        if (productFormMsg) productFormMsg.textContent = '';
      });
    }

    // Orders
    if (refreshOrdersBtn) refreshOrdersBtn.addEventListener('click', () => loadOrders().catch((e) => alert(e.message)));

    // Payments
    if (refreshPaymentsBtn) refreshPaymentsBtn.addEventListener('click', () => loadPayments().catch((e) => alert(e.message)));
    if (paymentsStatusFilter) paymentsStatusFilter.addEventListener('change', () => loadPayments().catch((e) => alert(e.message)));
    if (payModalClose) payModalClose.addEventListener('click', closePaymentModal);
    if (payModal) payModal.addEventListener('click', (e) => {
      // click outside modal box closes
      if (e.target === payModal) closePaymentModal();
    });

    // Settings (bank)
    if (bankForm) {
      bankForm.addEventListener('submit', (ev) => {
        ev.preventDefault();
        saveBankDetails().catch((e) => {
          if (bankMsg) bankMsg.textContent = 'Error: ' + e.message;
          alert(e.message);
        });
      });
    }

    // Period dropdown
    if (periodSelect) periodSelect.addEventListener('change', () => loadAnalyticsSafe().catch(() => {}));
  }

  // ---------- Boot ----------
  async function boot() {
    const urlToken = getTokenFromUrl();
    const existing = getToken();
    const chosen = urlToken || existing;

    setInputValueSafe(tokenInput, chosen);

    if (chosen) {
      try {
        await doLogin(chosen);
        return;
      } catch {
        clearToken();
      }
    }

    showLogin();
  }

  window.addEventListener('DOMContentLoaded', () => {
    // Small button helper (keeps CSS minimal)
    const style = document.createElement('style');
    style.textContent = `
      .smallBtn { padding: 8px 10px; font-size: 12px; border-radius: 10px; }
    `;
    document.head.appendChild(style);

    wireEvents();
    boot().catch((e) => {
      clearToken();
      showLogin();
      alert('Login failed: ' + e.message);
    });
  });
})();