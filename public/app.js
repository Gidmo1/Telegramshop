(() => {
  const $ = (id) => document.getElementById(id);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  const TOKEN_KEY = "orderlyy_token";

  const loginSection = $("login");
  const appSection = $("app");
  const tokenInput = $("tokenInput");
  const loginBtn = $("loginBtn");
  const logoutBtn = $("logoutBtn");

  const sidebar = $("sidebar");
  const hamburger = $("hamburger");
  const backdrop = $("backdrop");
  const navBtns = qsa(".navBtn");

  const pages = {
    overview: $("page-overview"),
    products: $("page-products"),
    orders: $("page-orders"),
    payments: $("page-payments"),
    settings: $("page-settings"),
  };

  const storeInfo = $("storeInfo");
  const periodSelect = $("periodSelect");
  const analyticsMsg = $("analyticsMsg");

  const kpiOrders = $("kpiOrders");
  const kpiOrdersDelta = $("kpiOrdersDelta");
  const kpiRevenue = $("kpiRevenue");
  const kpiRevenueDelta = $("kpiRevenueDelta");
  const kpiPending = $("kpiPending");
  const kpiPendingDelta = $("kpiPendingDelta");
  const kpiProducts = $("kpiProducts");
  const kpiProductsDelta = $("kpiProductsDelta");

  const ordersChartCanvas = $("ordersChart");
  let ordersChart = null;

  const refreshProductsBtn = $("refreshProducts");
  const productForm = $("productForm");
  const productFormMsg = $("productFormMsg");
  const clearProductFormBtn = $("clearProductForm");
  const productsTable = $("productsTable");
  const productsTbody = productsTable ? productsTable.querySelector("tbody") : null;

  const refreshOrdersBtn = $("refreshOrders");
  const ordersTable = $("ordersTable");
  const ordersTbody = ordersTable ? ordersTable.querySelector("tbody") : null;

  const refreshPaymentsBtn = $("refreshPayments");
  const paymentStatusFilter = $("paymentStatusFilter");
  const paymentsMsg = $("paymentsMsg");
  const paymentsTable = $("paymentsTable");
  const paymentsTbody = paymentsTable ? paymentsTable.querySelector("tbody") : null;

  const proofModal = $("proofModal");
  const proofImg = $("proofImg");
  const proofClose = $("proofClose");
  const proofMeta = $("proofMeta");

  const settingsStoreInfo = $("settingsStoreInfo");
  const bankForm = $("bankForm");
  const bankClear = $("bankClear");
  const bankMsg = $("bankMsg");

  const planBox = $("planBox");
  const tokenMasked = $("tokenMasked");
  const copyDashLink = $("copyDashLink");
  const copyMsg = $("copyMsg");
  const settingsSupportLink = $("settingsSupportLink");

  const subPill = $("subPill");
  const supportLinkEl = $("supportLink");

  let cachedStore = null;
  let cachedProducts = [];
  let cachedOrders = [];
  let cachedPayments = [];

  function getTokenFromUrl() {
    try {
      const url = new URL(location.href);
      return (url.searchParams.get("token") || "").trim();
    } catch {
      return "";
    }
  }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function getToken() { return (localStorage.getItem(TOKEN_KEY) || "").trim(); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function formatMoney(cur, v) {
    if (cur == null) return String(v);
    return `${cur}${v}`;
  }

  function maskToken(t) {
    const token = String(t || "");
    if (token.length <= 10) return token;
    return `${token.slice(0, 6)}…${token.slice(-4)}`;
  }

  function isMobile() {
    return window.matchMedia("(max-width: 900px)").matches;
  }

  async function api(path, { method = "GET", body } = {}) {
    const token = getToken();
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetch(path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function showLogin() {
    if (loginSection) loginSection.hidden = false;
    if (appSection) appSection.hidden = true;
    if (logoutBtn) logoutBtn.hidden = true;
  }

  function showApp() {
    if (loginSection) loginSection.hidden = true;
    if (appSection) appSection.hidden = false;
    if (logoutBtn) logoutBtn.hidden = false;
  }

  function openSidebar() {
    if (!sidebar || !backdrop) return;
    sidebar.classList.add("open");
    backdrop.hidden = false;
  }
  function closeSidebar() {
    if (!sidebar || !backdrop) return;
    sidebar.classList.remove("open");
    backdrop.hidden = true;
  }

  function setActivePage(name) {
    navBtns.forEach((b) => b.classList.toggle("active", b.dataset.page === name));

    Object.entries(pages).forEach(([k, el]) => {
      if (!el) return;
      el.hidden = k !== name;
    });

    if (isMobile()) closeSidebar();

    if (name === "overview") loadAnalytics().catch(() => {});
    if (name === "products") loadProducts().catch(() => {});
    if (name === "orders") loadOrders().catch(() => {});
    if (name === "payments") loadPayments().catch((e) => showPaymentsMsg(e));
    if (name === "settings") renderSettings();
  }

  function setSubUI(store) {
    if (!store) return;

    const active = !!store.subscription_active;
    const status = String(store.subscription_status || "unknown").toLowerCase();
    const exp = store.subscription_expires_at ? ` · exp ${store.subscription_expires_at}` : "";

    if (subPill) {
      const label =
        status === "trial" ? "Trial" :
        status === "active" ? "Active" :
        status === "expired" ? "Expired" :
        status;

      subPill.textContent = `${active ? "✅" : "🔒"} ${label}${exp}`;
    }

    const sup =
      store.support_link ||
      (store.support_username ? `https://t.me/${store.support_username}` : `https://t.me/orderlyysupport`);

    if (supportLinkEl) supportLinkEl.href = sup;
    if (settingsSupportLink) settingsSupportLink.href = sup;
  }

  function writeBlockedMsg(e) {
    if (e && e.status === 402 && (e.message || "").includes("subscription_required")) {
      const sup =
        cachedStore?.support_link ||
        (cachedStore?.support_username ? `https://t.me/${cachedStore.support_username}` : "https://t.me/orderlyysupport");
      return `🔒 Subscription required. Activate via support: ${sup}`;
    }
    return e?.message || "Something went wrong.";
  }

  function setDelta(el, pct) {
    if (!el) return;
    const n = Number(pct);

    if (!Number.isFinite(n)) {
      el.className = "kpiDelta deltaFlat";
      el.textContent = "—";
      return;
    }

    const abs = Math.abs(n).toFixed(1);
    if (n > 0) {
      el.className = "kpiDelta deltaUp";
      el.innerHTML = `<span class="tri up"></span><span>+${abs}%</span>`;
    } else if (n < 0) {
      el.className = "kpiDelta deltaDown";
      el.innerHTML = `<span class="tri down"></span><span>-${abs}%</span>`;
    } else {
      el.className = "kpiDelta deltaFlat";
      el.innerHTML = `<span>0.0%</span>`;
    }
  }

  function buildChart(labels, values) {
    if (!ordersChartCanvas || typeof Chart === "undefined") return;

    const data = {
      labels,
      datasets: [{
        label: "Orders",
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
    };

    if (!ordersChart) {
      ordersChart = new Chart(ordersChartCanvas.getContext("2d"), {
        type: "line",
        data,
        options,
      });
    } else {
      ordersChart.data = data;
      ordersChart.update();
    }
  }

  async function loadStore() {
    const out = await api("/api/store");
    cachedStore = out.store || null;

    setSubUI(cachedStore);

    if (storeInfo && cachedStore) {
      storeInfo.innerHTML = `
        <div><b>Name:</b> ${escapeHtml(cachedStore.name || "")}</div>
        <div><b>Currency:</b> ${escapeHtml(cachedStore.currency || "")}</div>
        <div><b>Channel:</b> ${
          cachedStore.channel_username ? "@"+escapeHtml(cachedStore.channel_username) :
          (cachedStore.channel_id ? escapeHtml(cachedStore.channel_id) : '<span class="muted">Not linked</span>')
        }</div>
        <div><b>Delivery note:</b> ${escapeHtml(cachedStore.delivery_note || "")}</div>
      `;
    }

    if (settingsStoreInfo && cachedStore) {
      settingsStoreInfo.innerHTML = `
        <div><b>Store:</b> ${escapeHtml(cachedStore.name || "")}</div>
        <div><b>Currency:</b> ${escapeHtml(cachedStore.currency || "")}</div>
      `;
    }

    if (tokenMasked) tokenMasked.textContent = maskToken(getToken());
    return cachedStore;
  }

  async function loadAnalytics() {
    if (!cachedStore) return;

    const period = periodSelect ? periodSelect.value : "30d";
    try {
      const out = await api(`/api/analytics?period=${encodeURIComponent(period)}`);
      const a = out.analytics || {};

      if (kpiOrders) kpiOrders.textContent = String(a.orders_total ?? "—");
      setDelta(kpiOrdersDelta, a.orders_change_pct);

      if (kpiRevenue) kpiRevenue.textContent = String(a.revenue_total ?? "—");
      setDelta(kpiRevenueDelta, a.revenue_change_pct);

      if (kpiPending) kpiPending.textContent = String(a.pending_total ?? "—");
      setDelta(kpiPendingDelta, a.pending_change_pct);

      if (kpiProducts) kpiProducts.textContent = String(a.products_total ?? "—");
      setDelta(kpiProductsDelta, a.products_change_pct);

      const labels = a.series?.labels || [];
      const values = a.series?.values || [];
      if (labels.length && values.length) buildChart(labels, values);

      if (analyticsMsg) analyticsMsg.textContent = "";
    } catch (e) {
      if (analyticsMsg) analyticsMsg.textContent = e.message || "Analytics unavailable.";
      if (kpiOrders) kpiOrders.textContent = String(cachedOrders.length || 0);
      setDelta(kpiOrdersDelta, NaN);
      if (kpiProducts) kpiProducts.textContent = String(cachedProducts.length || 0);
      setDelta(kpiProductsDelta, NaN);
      if (kpiPending) kpiPending.textContent = String(cachedOrders.filter(o => o.status === "pending").length || 0);
      setDelta(kpiPendingDelta, NaN);
      if (kpiRevenue) kpiRevenue.textContent = "—";
      setDelta(kpiRevenueDelta, NaN);
    }
  }

  async function loadProducts() {
    const out = await api("/api/products");
    cachedProducts = out.products || [];
    renderProducts();
    return cachedProducts;
  }

  function renderProducts() {
    if (!productsTbody || !cachedStore) return;
    productsTbody.innerHTML = "";

    for (const p of cachedProducts) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(p.name || "")}</td>
        <td>${escapeHtml(formatMoney(cachedStore.currency, p.price))}</td>
        <td>${p.in_stock ? '<span class="badge ok">In stock</span>' : '<span class="badge bad">Out</span>'}</td>
        <td class="muted">${p.photo_file_id ? `<code>${escapeHtml(p.photo_file_id)}</code>` : ""}</td>
        <td>
          <button class="btn tiny secondary" data-act="toggle" data-id="${escapeHtml(p.id)}">Toggle</button>
          <button class="btn tiny secondary" data-act="edit" data-id="${escapeHtml(p.id)}">Edit</button>
        </td>
      `;
      productsTbody.appendChild(tr);
    }
  }

  async function toggleStock(productId) {
    const product = cachedProducts.find(p => p.id === productId);
    if (!product) throw new Error("Product not found");

    await api(`/api/products/${encodeURIComponent(productId)}`, {
      method: "PUT",
      body: {
        name: product.name,
        price: product.price,
        description: product.description || "",
        in_stock: product.in_stock ? 0 : 1,
        photo_file_id: product.photo_file_id || null,
      },
    });
  }

  async function editProduct(productId) {
    const product = cachedProducts.find(p => p.id === productId);
    if (!product) throw new Error("Product not found");

    const name = prompt("Product name", product.name || "");
    if (name === null) return;

    const priceStr = prompt("Price (number)", String(product.price ?? 0));
    if (priceStr === null) return;

    const price = Number(priceStr);
    if (!Number.isFinite(price) || price < 0) throw new Error("Invalid price");

    const description = prompt("Description", product.description || "") ?? "";
    const inStock = confirm("In stock? (OK=yes, Cancel=no)") ? 1 : 0;
    const photo_file_id = prompt("Photo file_id (optional)", product.photo_file_id || "") ?? "";

    await api(`/api/products/${encodeURIComponent(productId)}`, {
      method: "PUT",
      body: {
        name: name.trim(),
        price,
        description: description.trim(),
        in_stock: inStock,
        photo_file_id: photo_file_id.trim() || null,
      },
    });
  }

  async function addProductFromForm() {
    if (!productForm || !productFormMsg) return;

    productFormMsg.textContent = "";

    const fd = new FormData(productForm);
    const name = String(fd.get("name") || "").trim();
    const price = Number(fd.get("price") || 0);
    const description = String(fd.get("description") || "").trim();
    const in_stock = String(fd.get("in_stock") || "1") === "1" ? 1 : 0;
    const photo_file_id = String(fd.get("photo_file_id") || "").trim() || null;

    if (!name || !Number.isFinite(price)) {
      productFormMsg.textContent = "Name and numeric price are required.";
      return;
    }

    await api("/api/products", {
      method: "POST",
      body: { name, price, description, in_stock, photo_file_id },
    });

    productForm.reset();
    const stockSel = productForm.querySelector('select[name="in_stock"]');
    if (stockSel) stockSel.value = "1";

    productFormMsg.textContent = "Product added ✅";
    await loadProducts();
    await loadOrders();
    await loadAnalytics();
  }

  async function loadOrders() {
    const out = await api("/api/orders");
    cachedOrders = out.orders || [];
    renderOrders();
    return cachedOrders;
  }

  function renderOrders() {
    if (!ordersTbody) return;
    ordersTbody.innerHTML = "";

    for (const o of cachedOrders) {
      const buyer = o.buyer_username ? "@"+escapeHtml(o.buyer_username) : '<span class="muted">(unknown)</span>';
      const delivery = o.delivery_text ? `<div class="small muted" style="margin-top:6px; white-space:pre-wrap">${escapeHtml(o.delivery_text)}</div>` : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${escapeHtml(o.id)}</code></td>
        <td>${escapeHtml(o.product_name || "")}${delivery}</td>
        <td>${buyer}</td>
        <td>${escapeHtml(String(o.qty || ""))}</td>
        <td><span class="badge">${escapeHtml(o.status || "")}</span></td>
        <td>
          <button class="btn tiny secondary" data-act="done" data-id="${escapeHtml(o.id)}">Done</button>
          <button class="btn tiny secondary" data-act="pending" data-id="${escapeHtml(o.id)}">Pending</button>
        </td>
      `;
      ordersTbody.appendChild(tr);
    }
  }

  async function setOrderStatus(orderId, status) {
    await api(`/api/orders/${encodeURIComponent(orderId)}/status`, {
      method: "PUT",
      body: { status },
    });
  }

  function showPaymentsMsg(e) {
    if (!paymentsMsg) return;
    paymentsMsg.textContent = e ? writeBlockedMsg(e) : "";
  }

  async function loadPayments() {
    if (!paymentsTbody) return;

    showPaymentsMsg(null);

    const status = paymentStatusFilter ? paymentStatusFilter.value : "";
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";

    const out = await api(`/api/payments${qs}`);
    cachedPayments = out.payments || [];
    renderPayments();
  }

  function renderPayments() {
    if (!paymentsTbody || !cachedStore) return;
    paymentsTbody.innerHTML = "";

    for (const p of cachedPayments) {
      const status = String(p.status || "");
      const statusBadge =
        status === "awaiting" ? `<span class="badge warn">Awaiting</span>` :
        status === "confirmed" ? `<span class="badge ok">Confirmed</span>` :
        status === "rejected" ? `<span class="badge bad">Rejected</span>` :
        `<span class="badge">${escapeHtml(status)}</span>`;

      const proofBtn = p.proof_file_id
        ? `<button class="btn tiny secondary" data-act="proof" data-id="${escapeHtml(p.id)}">View proof</button>`
        : `<span class="muted small">No proof</span>`;

      const actions =
        status === "awaiting"
          ? `
            <button class="btn tiny okBtn" data-act="approve" data-id="${escapeHtml(p.id)}">Approve</button>
            <button class="btn tiny danger" data-act="reject" data-id="${escapeHtml(p.id)}">Reject</button>
          `
          : `<span class="muted small">—</span>`;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><code>${escapeHtml(p.order_id || "")}</code></td>
        <td>${escapeHtml(p.product_name || "")}</td>
        <td>${escapeHtml(p.buyer_username ? "@"+p.buyer_username : (p.buyer_id || ""))}</td>
        <td>${escapeHtml(formatMoney(p.currency || cachedStore.currency, p.amount || 0))}</td>
        <td>${statusBadge}</td>
        <td class="flexCell">
          ${proofBtn}
          ${actions}
        </td>
      `;
      paymentsTbody.appendChild(tr);
    }
  }

  function openProofModal(paymentId) {
    if (!proofModal || !proofImg) return;

    proofImg.src = "";
    proofModal.hidden = false;

    // ✅ IMPORTANT FIX: add ?token=... because <img> does not send Authorization header
    const token = getToken();
    const url = `/api/payments/${encodeURIComponent(paymentId)}/proof?token=${encodeURIComponent(token)}`;
    proofImg.src = url;

    const p = cachedPayments.find((x) => x.id === paymentId);
    if (proofMeta) {
      proofMeta.innerHTML = p
        ? `Order: <code>${escapeHtml(p.order_id || "")}</code> · Buyer: <b>${escapeHtml(p.buyer_username ? "@"+p.buyer_username : (p.buyer_id || ""))}</b>`
        : "";
    }
  }

  function closeProofModal() {
    if (!proofModal || !proofImg) return;
    proofModal.hidden = true;
    proofImg.src = "";
  }

  async function approvePayment(paymentId) {
    await api(`/api/payments/${encodeURIComponent(paymentId)}/approve`, { method: "PUT" });
  }

  async function rejectPayment(paymentId) {
    await api(`/api/payments/${encodeURIComponent(paymentId)}/reject`, { method: "PUT" });
  }

  function renderSettings() {
    if (!cachedStore) return;

    if (planBox) {
      const active = !!cachedStore.subscription_active;
      const status = String(cachedStore.subscription_status || "unknown").toLowerCase();
      const exp = cachedStore.subscription_expires_at || "—";
      const supUser = cachedStore.support_username || "orderlyysupport";
      const supLink = cachedStore.support_link || `https://t.me/${supUser}`;

      planBox.innerHTML = `
        <div class="planRow">
          <div>
            <div class="muted small">Plan</div>
            <div class="big">${escapeHtml(status.toUpperCase())}</div>
          </div>
          <div>
            <div class="muted small">Status</div>
            <div class="big">${active ? "✅ ACTIVE" : "🔒 INACTIVE"}</div>
          </div>
          <div>
            <div class="muted small">Expiry</div>
            <div class="big">${escapeHtml(exp)}</div>
          </div>
        </div>
        <div class="muted small" style="margin-top:10px;">
          Need activation? Contact support: <a href="${escapeHtml(supLink)}" target="_blank" rel="noreferrer">@${escapeHtml(supUser)}</a>
        </div>
      `;
    }

    if (bankForm) {
      const bank = bankForm.querySelector('input[name="bank_name"]');
      const acct = bankForm.querySelector('input[name="account_number"]');
      const name = bankForm.querySelector('input[name="account_name"]');

      if (bank) bank.value = cachedStore.bank_name || "";
      if (acct) acct.value = cachedStore.account_number || "";
      if (name) name.value = cachedStore.account_name || "";
    }

    if (tokenMasked) tokenMasked.textContent = maskToken(getToken());
    setSubUI(cachedStore);
  }

  async function saveBankDetails() {
    if (!bankForm || !bankMsg) return;

    bankMsg.textContent = "";

    const bank_name = String(bankForm.querySelector('input[name="bank_name"]')?.value || "").trim();
    const account_number = String(bankForm.querySelector('input[name="account_number"]')?.value || "").trim();
    const account_name = String(bankForm.querySelector('input[name="account_name"]')?.value || "").trim();

    if (!bank_name || !account_number || !account_name) {
      bankMsg.textContent = "All fields are required.";
      return;
    }

    try {
      await api("/api/store/bank", {
        method: "PUT",
        body: { bank_name, account_number, account_name },
      });
      bankMsg.textContent = "Saved ✅";
      await loadStore();
      renderSettings();
    } catch (e) {
      bankMsg.textContent = writeBlockedMsg(e);
    }
  }

  async function copyDashboardLink() {
    if (!copyMsg) return;

    const token = getToken();
    if (!token) {
      copyMsg.textContent = "No token.";
      return;
    }

    const base = location.origin + location.pathname;
    const link = `${base}?token=${encodeURIComponent(token)}`;

    try {
      await navigator.clipboard.writeText(link);
      copyMsg.textContent = "Copied ✅";
    } catch {
      copyMsg.textContent = "Copy failed. (Your browser blocked clipboard)";
    }
  }

  async function loadAllCore() {
    await loadStore();
    await Promise.all([
      loadProducts().catch(() => {}),
      loadOrders().catch(() => {}),
    ]);
    await loadAnalytics().catch(() => {});
  }

  async function doLogin(token) {
    if (!token) throw new Error("Missing token");
    setToken(token);
    showApp();
    await loadAllCore();
    setActivePage("overview");
  }

  function wireEvents() {
    if (hamburger) hamburger.addEventListener("click", openSidebar);
    if (backdrop) backdrop.addEventListener("click", closeSidebar);

    navBtns.forEach((btn) => {
      btn.addEventListener("click", () => setActivePage(btn.dataset.page));
    });

    if (loginBtn) {
      loginBtn.addEventListener("click", async () => {
        const t = tokenInput ? tokenInput.value.trim() : "";
        if (!t) return;
        try {
          await doLogin(t);
        } catch (e) {
          clearToken();
          alert("Login failed: " + (e.message || e));
          showLogin();
        }
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        clearToken();
        location.href = location.pathname;
      });
    }

    if (periodSelect) {
      periodSelect.addEventListener("change", () => loadAnalytics().catch(() => {}));
    }

    if (refreshProductsBtn) {
      refreshProductsBtn.addEventListener("click", () => loadProducts().catch((e) => alert(e.message)));
    }

    if (productsTbody) {
      productsTbody.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("button");
        if (!btn) return;

        const act = btn.getAttribute("data-act");
        const id = btn.getAttribute("data-id");
        if (!act || !id) return;

        try {
          if (act === "toggle") {
            await toggleStock(id);
            await loadProducts();
            await loadAnalytics();
          } else if (act === "edit") {
            await editProduct(id);
            await loadProducts();
            await loadAnalytics();
          }
        } catch (e) {
          alert(writeBlockedMsg(e));
        }
      });
    }

    if (productForm) {
      productForm.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        try {
          await addProductFromForm();
        } catch (e) {
          if (productFormMsg) productFormMsg.textContent = writeBlockedMsg(e);
          alert(writeBlockedMsg(e));
        }
      });
    }

    if (clearProductFormBtn && productForm) {
      clearProductFormBtn.addEventListener("click", () => {
        productForm.reset();
        const stockSel = productForm.querySelector('select[name="in_stock"]');
        if (stockSel) stockSel.value = "1";
        if (productFormMsg) productFormMsg.textContent = "";
      });
    }

    if (refreshOrdersBtn) {
      refreshOrdersBtn.addEventListener("click", () => loadOrders().catch((e) => alert(e.message)));
    }

    if (ordersTbody) {
      ordersTbody.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("button");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        const id = btn.getAttribute("data-id");
        if (!act || !id) return;

        try {
          if (act === "done") await setOrderStatus(id, "done");
          if (act === "pending") await setOrderStatus(id, "pending");
          await loadOrders();
          await loadAnalytics();
        } catch (e) {
          alert(writeBlockedMsg(e));
        }
      });
    }

    if (refreshPaymentsBtn) {
      refreshPaymentsBtn.addEventListener("click", () => loadPayments().catch((e) => showPaymentsMsg(e)));
    }
    if (paymentStatusFilter) {
      paymentStatusFilter.addEventListener("change", () => loadPayments().catch((e) => showPaymentsMsg(e)));
    }

    if (paymentsTbody) {
      paymentsTbody.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("button");
        if (!btn) return;
        const act = btn.getAttribute("data-act");
        const id = btn.getAttribute("data-id");
        if (!act || !id) return;

        try {
          if (act === "proof") {
            openProofModal(id);
            return;
          }
          if (act === "approve") {
            if (!confirm("Approve this payment?")) return;
            await approvePayment(id);
            await loadPayments();
            await loadOrders();
            await loadAnalytics();
          }
          if (act === "reject") {
            if (!confirm("Reject this payment?")) return;
            await rejectPayment(id);
            await loadPayments();
            await loadOrders();
            await loadAnalytics();
          }
        } catch (e) {
          showPaymentsMsg(e);
        }
      });
    }

    if (proofClose) proofClose.addEventListener("click", closeProofModal);
    if (proofModal) {
      proofModal.addEventListener("click", (e) => {
        if (e.target === proofModal) closeProofModal();
      });
    }

    if (bankForm) {
      bankForm.addEventListener("submit", (ev) => {
        ev.preventDefault();
        saveBankDetails().catch((e) => {
          if (bankMsg) bankMsg.textContent = writeBlockedMsg(e);
        });
      });
    }

    if (bankClear && bankForm) {
      bankClear.addEventListener("click", () => {
        bankForm.reset();
        if (bankMsg) bankMsg.textContent = "";
      });
    }

    if (copyDashLink) {
      copyDashLink.addEventListener("click", () => copyDashboardLink());
    }
  }

  async function boot() {
    const urlToken = getTokenFromUrl();
    const existing = getToken();
    const chosen = urlToken || existing;

    if (tokenInput) tokenInput.value = chosen;

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

  window.addEventListener("DOMContentLoaded", () => {
    if (backdrop) backdrop.hidden = true;
    wireEvents();
    boot().catch((e) => {
      clearToken();
      showLogin();
      alert("Login failed: " + (e.message || e));
    });
  });
})();