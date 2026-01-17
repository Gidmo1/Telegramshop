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
  };

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

  // Token storage
  const TOKEN_KEY = 'cysb_token';

  // Cached data
  let cachedStore = null;
  let cachedProducts = [];
  let cachedOrders = [];

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
      throw new Error(msg);
    }
    return data;
  }

  function formatMoney(currency, value) {
    if (!currency) return String(value);
    return `${currency}${value}`;
  }

  // ---------- Tabs ----------
  function setActiveTab(tabName) {
    tabButtons.forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tabName);
    });
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

  // ---------- Store ----------
  async function loadStore() {
    const store = (await api('/api/store')).store;
    cachedStore = store;

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
      `;
    }
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
        <td>${p.in_stock ? '<span class="badge">In stock</span>' : '<span class="badge">Out</span>'}</td>
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
        const act = btn.getAttribute('data-act');
        const id = btn.getAttribute('data-id');

        try {
          if (act === 'toggle') {
            await toggleStock(id);
            await loadProducts();
            await loadAnalyticsSafe(); // so KPIs update
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

    // KPI fallback update (products count)
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
    if (!productForm) return;
    if (!productFormMsg) return;

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
    // keep default in_stock as Yes
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
        <td>${escapeHtml(o.status)}</td>
        <td>
          <button class="btn secondary smallBtn" data-act="done" data-id="${escapeAttr(o.id)}">Done</button>
          <button class="btn secondary smallBtn" data-act="pending" data-id="${escapeAttr(o.id)}">Pending</button>
        </td>
      `;
      ordersTbody.appendChild(tr);
    }

    ordersTbody.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', async () => {
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

    // KPI fallback update (pending)
    const pendingCount = cachedOrders.filter((o) => o.status === 'pending').length;
    setKpiValue(kpiPending, pendingCount);
  }

  // ---------- Analytics ----------
  function setKpiValue(el, val) {
    if (!el) return;
    el.textContent = String(val);
  }

  function setDelta(el, pct) {
    if (!el) return;

    // No data
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
      plugins: {
        legend: { display: false },
        tooltip: { enabled: true },
      },
      scales: {
        x: {
          ticks: { color: '#a7b0c0' },
          grid: { color: 'rgba(31,42,64,0.35)' },
        },
        y: {
          ticks: { color: '#a7b0c0', precision: 0 },
          grid: { color: 'rgba(31,42,64,0.35)' },
        },
      },
    };

    if (!ordersChart) {
      ordersChart = new Chart(ordersChartCanvas.getContext('2d'), {
        type: 'line',
        data,
        options,
      });
    } else {
      ordersChart.data = data;
      ordersChart.update();
    }
  }

  async function loadAnalyticsSafe() {
    if (!cachedStore) return;

    const period = periodSelect ? periodSelect.value : '30d';

    // If backend endpoint doesn't exist yet, don't crash the app.
    try {
      const out = await api(`/api/analytics?period=${encodeURIComponent(period)}`);

      // Expected shape (we'll implement backend next):
      // out.analytics = { orders_total, orders_change_pct, revenue_total, revenue_change_pct, pending_total, pending_change_pct, products_total, products_change_pct, series:{labels, values} }
      const a = out.analytics || out;

      // Values
      setKpiValue(kpiOrders, a.orders_total ?? cachedOrders.length);
      setDelta(kpiOrdersDelta, a.orders_change_pct);

      setKpiValue(kpiRevenue, a.revenue_total ?? 0);
      setDelta(kpiRevenueDelta, a.revenue_change_pct);

      const pendingFallback = cachedOrders.filter((o) => o.status === 'pending').length;
      setKpiValue(kpiPending, a.pending_total ?? pendingFallback);
      setDelta(kpiPendingDelta, a.pending_change_pct);

      setKpiValue(kpiProducts, a.products_total ?? cachedProducts.length);
      setDelta(kpiProductsDelta, a.products_change_pct);

      // Chart series
      const labels = a.series?.labels || [];
      const values = a.series?.values || [];
      if (labels.length && values.length) buildChart(labels, values);

      if (analyticsMsg) analyticsMsg.textContent = '';
    } catch (e) {
      // Fallback KPIs without graph
      const pending = cachedOrders.filter((o) => o.status === 'pending').length;

      setKpiValue(kpiOrders, cachedOrders.length);
      setDelta(kpiOrdersDelta, null);

      setKpiValue(kpiRevenue, 0);
      setDelta(kpiRevenueDelta, null);

      setKpiValue(kpiPending, pending);
      setDelta(kpiPendingDelta, null);

      setKpiValue(kpiProducts, cachedProducts.length);
      setDelta(kpiProductsDelta, null);

      if (analyticsMsg) {
        analyticsMsg.textContent = `Analytics not ready yet (${e.message}). We'll enable charts once /api/analytics is added.`;
      }
    }
  }

  // ---------- Load all ----------
  async function loadAll() {
    await loadStore();
    await Promise.all([loadProducts(), loadOrders()]);
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
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        setActiveTab(tab);
      });
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
    if (refreshProductsBtn) {
      refreshProductsBtn.addEventListener('click', () => loadProducts().catch((e) => alert(e.message)));
    }

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
    if (refreshOrdersBtn) {
      refreshOrdersBtn.addEventListener('click', () => loadOrders().catch((e) => alert(e.message)));
    }

    // Period dropdown
    if (periodSelect) {
      periodSelect.addEventListener('change', () => loadAnalyticsSafe().catch(() => {}));
    }
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
    // tiny style helper for button sizing (without rewriting css)
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