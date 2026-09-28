const appRoot = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const state = {
  status: null,
  catalog: null,
  page: "dashboard",
  sales: [],
  expenses: [],
  inventory: [],
  profitability: null,
  pnl: null,
  inventoryBalance: null,
  selectedMonth: null,
  stockAsOf: null,
};

const pageMeta = {
  dashboard: { title: "대시보드", sub: "오늘의 운영 기록을 한눈에 확인해요." },
  sales: { title: "판매 기록", sub: "날짜 · 메뉴 · 채널별 하루 판매 합계를 기록해요." },
  expenses: { title: "비용 기록", sub: "실제로 지출한 공통 비용을 기록해요." },
  inventory: { title: "재고 기록", sub: "입고 · 폐기 · 실사 내용을 남겨요." },
  profitability: { title: "메뉴 수익성", sub: "할인 후 매출에서 메뉴별 직접 비용만 차감해요." },
  pnl: { title: "기간별 손익", sub: "선택한 달의 실제 손익을 확인해요." },
  stock: { title: "재고 현황", sub: "최근 실사와 이후 기록을 기준으로 잔량과 발주 참고량을 계산해요." },
};

const icon = (name, size = 18) => {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/><path d="M9 21v-6h6v6"/>',
    sales: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 5-6"/><path d="M16 7h3v3"/>',
    expense: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M16 5V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v1M3 10h18M8 15h4"/>',
    stock: '<path d="m3 7 9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10M7.5 5l9 4"/>',
    chart: '<path d="M4 19V5M4 19h17"/><path d="M8 15v-3m4 3V7m4 8v-5m4 5V4"/>',
    trend: '<path d="M4 18 10 12l4 3 6-8"/><path d="M15 7h5v5"/>',
    leaf: '<path d="M20 4c-7 0-13 2-15 7-2 5 2 9 6 8 6-1 9-7 9-15Z"/><path d="M4 20c3-5 7-8 12-11"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    cup: '<path d="M5 8h12l-1 12H6L5 8Z"/><path d="M17 10h2.5a2.5 2.5 0 0 1 0 5H17M8 4c1 1 1 2 0 3m4-4c1 1 1 2 0 3"/>',
    logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6"/>',
    edit: '<path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/>',
    trash: '<path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function money(value) {
  return `${new Intl.NumberFormat("ko-KR").format(Math.round(Number(value) || 0))}원`;
}

function number(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("ko-KR", { maximumFractionDigits }).format(Number(value) || 0);
}

function today() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}-${parts.find((part) => part.type === "day").value}`;
}

function humanDate(date) {
  if (!date) return "";
  const [year, month, day] = date.split("-");
  return `${year}.${month}.${day}`;
}

function monthOf(date) { return date.slice(0, 7); }

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    error.field = payload.field;
    throw error;
  }
  return payload;
}

function toast(message, kind = "success") {
  const node = document.createElement("div");
  node.className = `toast ${kind === "error" ? "toast-error" : ""}`;
  node.innerHTML = `${icon(kind === "error" ? "close" : "check", 17)}<span>${escapeHtml(message)}</span>`;
  toastRegion.append(node);
  setTimeout(() => node.remove(), 3600);
}

async function initialize() {
  appRoot.innerHTML = `<div class="startup"><span class="brand-mark">${icon("cup", 23)}</span><span>화면을 준비하고 있어요</span></div>`;
  try {
    [state.status, state.catalog] = await Promise.all([api("/api/status"), api("/api/catalog")]);
    if (!state.status.authenticated) {
      renderAuth();
      return;
    }
    if (!pageMeta[location.hash.slice(1)]) state.page = "dashboard";
    else state.page = location.hash.slice(1);
    state.selectedMonth = state.selectedMonth || monthOf(today());
    state.stockAsOf = state.stockAsOf || today();
    await refreshRecords();
    renderApp();
    if (["profitability", "pnl", "stock"].includes(state.page)) loadInsightPage(state.page);
  } catch (error) {
    appRoot.innerHTML = `<main class="offline"><div class="offline-mark">${icon("cup", 28)}</div><p class="eyebrow">PREP CAFE</p><h1>로컬 앱 서버에 연결할 수 없어요</h1><p>프로젝트 폴더에서 <code>python3 app.py</code>를 실행한 뒤 다시 열어 주세요.</p></main>`;
  }
}

function renderAuth(errorMessage = "") {
  const hasOperator = state.status?.hasOperator;
  const title = hasOperator ? "다시 오셨네요" : "운영자 계정을 설정해 주세요";
  const description = hasOperator ? "프렙 카페 운영 기록을 안전하게 확인하세요." : "이 로컬 앱에서 사용할 운영자 계정을 한 번 만듭니다.";
  appRoot.innerHTML = `
    <main class="auth-page">
      <section class="auth-aside">
        <div class="brand lockup"><span class="brand-mark">${icon("cup", 24)}</span><span>프렙 카페</span></div>
        <div class="auth-story">
          <p class="eyebrow">A LITTLE MORE CLARITY, EVERY DAY</p>
          <h1>매장의 기록을<br><em>차분하게</em> 정리해요.</h1>
          <p>판매와 비용, 재고 변동을 한곳에 모아<br>운영의 흐름을 놓치지 않도록 도와드려요.</p>
        </div>
        <div class="auth-aside-bottom"><span class="leaf-dot">${icon("leaf", 17)}</span>운영 데이터는 이 앱의 로컬 저장소에 보관됩니다.</div>
      </section>
      <section class="auth-main">
        <div class="auth-form-wrap">
          <div class="auth-form-head"><p class="eyebrow">OPERATOR ACCESS</p><h2>${title}</h2><p>${description}</p></div>
          <form id="auth-form" class="auth-form" novalidate>
            <label class="field"><span>이메일</span><input name="email" type="email" autocomplete="username" placeholder="owner@example.com" required maxlength="254"></label>
            <label class="field"><span>비밀번호</span><input name="password" type="password" autocomplete="${hasOperator ? "current-password" : "new-password"}" placeholder="${hasOperator ? "비밀번호를 입력해 주세요" : "10자 이상 입력해 주세요"}" required ${hasOperator ? "" : "minlength=10"}></label>
            <div id="auth-error" class="inline-error" ${errorMessage ? "" : "hidden"}>${escapeHtml(errorMessage)}</div>
            <button class="button button-primary button-wide" type="submit">${hasOperator ? "로그인" : "계정 만들고 시작하기"}<span>${icon("arrow", 17)}</span></button>
          </form>
          <p class="auth-footnote">${icon("lock", 15)} 로그인 세션은 이 기기의 로컬 앱에서만 사용됩니다.</p>
        </div>
        <div class="auth-corner">PREP CAFE · OPERATIONS JOURNAL</div>
      </section>
    </main>`;
  document.querySelector("#auth-form").addEventListener("submit", onAuthSubmit);
}

async function onAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const button = form.querySelector("button[type=submit]");
  const errorNode = document.querySelector("#auth-error");
  errorNode.hidden = true;
  if (!form.reportValidity()) return;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span> 확인 중`;
  const creatingOperator = !state.status.hasOperator;
  try {
    await api(state.status.hasOperator ? "/api/login" : "/api/setup", { method: "POST", body: Object.fromEntries(formData) });
    state.status = await api("/api/status");
    await refreshRecords();
    renderApp();
    if (creatingOperator) toast("운영자 계정을 만들었습니다.");
  } catch (error) {
    if (error.status === 409 && !state.status.hasOperator) {
      state.status = await api("/api/status");
      renderAuth("운영자 계정이 이미 설정되어 있습니다. 로그인해 주세요.");
    } else {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      button.disabled = false;
      button.innerHTML = `${state.status.hasOperator ? "로그인" : "계정 만들고 시작하기"}<span>${icon("arrow", 17)}</span>`;
    }
  }
}

async function refreshRecords() {
  [state.sales, state.expenses, state.inventory] = await Promise.all([
    api("/api/sales"), api("/api/expenses"), api("/api/inventory"),
  ]);
}

function renderApp() {
  const meta = pageMeta[state.page] || pageMeta.dashboard;
  appRoot.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#dashboard" data-nav="dashboard"><span class="brand-mark">${icon("cup", 22)}</span><span>프렙 카페</span></a>
        <div class="sidebar-label">운영 조회</div>
        <nav class="nav-list" aria-label="주요 메뉴">
          ${navItem("dashboard", "대시보드", "home")}
          ${navItem("sales", "판매 기록", "sales", state.sales.length)}
          ${navItem("expenses", "비용 기록", "expense")}
          ${navItem("inventory", "재고 기록", "stock")}
          ${navItem("profitability", "메뉴 수익성", "chart")}
          ${navItem("pnl", "기간별 손익", "trend")}
          ${navItem("stock", "재고 현황", "leaf")}
        </nav>
        <div class="sidebar-bottom">
          <div class="local-note"><span class="local-note-icon">${icon("lock", 15)}</span><div><strong>이 기기의 로컬 앱</strong><p>자료는 이 프로젝트의 로컬 데이터베이스에 저장돼요.</p></div></div>
          <button class="user-row" id="logout-button" type="button"><span class="avatar">${escapeHtml((state.status.operator?.email || "O").slice(0, 1).toUpperCase())}</span><span class="user-email">${escapeHtml(state.status.operator?.email || "운영자")}</span><span class="logout-icon">${icon("logout", 17)}</span></button>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar"><div class="breadcrumb">프렙 카페 <span>/</span> <strong>${meta.title}</strong></div><div class="topbar-right"><span class="today-label">${humanDate(today())}</span><span class="operator-pill"><span></span>운영자 모드</span></div></header>
        <div class="page-content">
          <div class="page-heading"><div><p class="eyebrow">OPERATIONS JOURNAL</p><h1>${meta.title}</h1><p>${meta.sub}</p></div>${pageAction()}</div>
          <section class="view" id="view">${renderCurrentPage()}</section>
          <footer class="app-footer"><span>프렙 카페 운영 기록</span><span>로그인 필요 · 변경 내용은 로컬 데이터베이스에 저장</span></footer>
        </div>
      </main>
    </div>
    <div id="modal-root"></div>`;
  document.querySelectorAll("[data-nav]").forEach((node) => node.addEventListener("click", (event) => {
    event.preventDefault();
    navigate(node.dataset.nav);
  }));
  document.querySelector("#logout-button").addEventListener("click", logout);
  document.querySelectorAll("[data-action=add]").forEach((node) => node.addEventListener("click", () => openRecordForm(state.page)));
  document.querySelectorAll("[data-action=inventory-add]").forEach((node) => node.addEventListener("click", () => openRecordForm("inventory", null, node.dataset.type)));
  document.querySelectorAll("[data-edit]").forEach((node) => node.addEventListener("click", () => editRecord(node.dataset.kind, node.dataset.edit)));
  document.querySelectorAll("[data-delete]").forEach((node) => node.addEventListener("click", () => deleteRecord(node.dataset.kind, node.dataset.delete)));
  document.querySelectorAll("[data-shortcut]").forEach((node) => node.addEventListener("click", () => navigate(node.dataset.shortcut)));
  document.querySelector("#period-month")?.addEventListener("change", (event) => {
    state.selectedMonth = event.target.value;
    loadInsightPage(state.page);
  });
  document.querySelector("#stock-as-of")?.addEventListener("change", (event) => {
    state.stockAsOf = event.target.value;
    loadInsightPage("stock");
  });
}

function navItem(page, label, glyph, count) {
  return `<a class="nav-item ${state.page === page ? "active" : ""}" href="#${page}" data-nav="${page}">${icon(glyph)}<span>${label}</span>${count ? `<small>${count}</small>` : ""}</a>`;
}

function pageAction() {
  if (state.page === "dashboard") return `<button class="button button-primary" data-shortcut="sales">${icon("plus", 17)} 판매 기록 추가</button>`;
  if (state.page === "sales") return `<button class="button button-primary" data-action="add">${icon("plus", 17)} 판매 입력</button>`;
  if (state.page === "expenses") return `<button class="button button-primary" data-action="add">${icon("plus", 17)} 비용 입력</button>`;
  if (state.page === "inventory") return `<button class="button button-primary" data-action="add">${icon("plus", 17)} 재고 기록 추가</button>`;
  if (state.page === "profitability" || state.page === "pnl") return `<label class="period-picker"><span>조회 월</span><select id="period-month">${monthOptions()}</select></label>`;
  if (state.page === "stock") return `<label class="period-picker"><span>기준일</span><input id="stock-as-of" type="date" value="${escapeHtml(state.stockAsOf || today())}"></label>`;
  return "";
}

function navigate(page) {
  if (!pageMeta[page]) return;
  state.page = page;
  history.replaceState(null, "", `#${page}`);
  renderApp();
  if (["profitability", "pnl", "stock"].includes(page)) loadInsightPage(page);
}

async function loadInsightPage(page) {
  try {
    if (page === "profitability") state.profitability = await api(`/api/profitability?month=${encodeURIComponent(state.selectedMonth || monthOf(today()))}`);
    if (page === "pnl") state.pnl = await api(`/api/pnl?month=${encodeURIComponent(state.selectedMonth || monthOf(today()))}`);
    if (page === "stock") state.inventoryBalance = await api(`/api/inventory/balance?asOf=${encodeURIComponent(state.stockAsOf || today())}`);
    if (state.page === page) renderApp();
  } catch (error) {
    toast(error.message, "error");
  }
}

function renderCurrentPage() {
  if (state.page === "sales") return renderSales();
  if (state.page === "expenses") return renderExpenses();
  if (state.page === "inventory") return renderInventory();
  if (state.page === "profitability") return renderProfitability();
  if (state.page === "pnl") return renderPnl();
  if (state.page === "stock") return renderStockBalance();
  return renderDashboard();
}

function renderDashboard() {
  const currentDate = today();
  const currentMonth = monthOf(currentDate);
  const salesToday = state.sales.filter((item) => item.date === currentDate);
  const netToday = salesToday.reduce((sum, item) => sum + item.netSales, 0);
  const quantityToday = salesToday.reduce((sum, item) => sum + item.quantity, 0);
  const expensesMonth = state.expenses.filter((item) => monthOf(item.date) === currentMonth).reduce((sum, item) => sum + item.amount, 0);
  const recentSales = [...state.sales].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  return `
    <div class="welcome-banner"><div class="welcome-copy"><span class="welcome-icon">${icon("leaf", 18)}</span><div><strong>안녕하세요, 오늘의 기록을 시작해 볼까요?</strong><p>입력한 운영 기록은 바로 저장되어 목록에서 다시 확인할 수 있어요.</p></div></div><span class="welcome-date">${humanDate(currentDate)}</span></div>
    <div class="metric-grid">
      <article class="metric-card"><div class="metric-label">오늘 순매출 <span class="metric-icon mint">${icon("sales", 17)}</span></div><strong>${money(netToday)}</strong><p>총매출에서 할인 금액을 뺀 금액</p></article>
      <article class="metric-card"><div class="metric-label">오늘 판매 수량 <span class="metric-icon peach">${icon("cup", 17)}</span></div><strong>${number(quantityToday)}<small>개</small></strong><p>${salesToday.length ? `${salesToday.length}건의 메뉴별 합계` : "판매 기록이 아직 없어요"}</p></article>
      <article class="metric-card"><div class="metric-label">이번 달 비용 기록 <span class="metric-icon blue">${icon("expense", 17)}</span></div><strong>${money(expensesMonth)}</strong><p>월 계획과 합산하지 않은 실제 기록</p></article>
    </div>
    <div class="dashboard-columns">
      <section class="panel recent-panel"><div class="panel-heading"><div><h2>최근 판매 기록</h2><p>저장한 판매 내역을 확인해요.</p></div><button class="text-button" data-shortcut="sales">전체 보기 ${icon("arrow", 15)}</button></div>
        ${recentSales.length ? `<div class="table-wrap"><table><thead><tr><th>날짜</th><th>메뉴 · 채널</th><th>수량</th><th class="align-right">순매출</th></tr></thead><tbody>${recentSales.map((item) => `<tr><td class="date-cell">${humanDate(item.date)}</td><td><strong>${escapeHtml(item.menuName)}</strong><span class="sub-cell">${escapeHtml(item.channel)}</span></td><td>${number(item.quantity)}개</td><td class="align-right amount-cell">${money(item.netSales)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("아직 판매 기록이 없어요", "첫 판매 기록을 입력하면 이곳에서 바로 확인할 수 있어요.", "sales", "판매 기록 입력")}
      </section>
      <section class="panel quick-panel"><div class="panel-heading"><div><h2>빠른 기록</h2><p>오늘의 운영 상황을 기록해 보세요.</p></div><span class="quick-mark">${icon("plus", 19)}</span></div>
        <button class="quick-action" data-shortcut="sales"><span class="quick-action-icon mint">${icon("sales", 18)}</span><span><strong>판매 기록 입력</strong><small>메뉴별 하루 판매 합계</small></span><span class="quick-arrow">${icon("arrow", 16)}</span></button>
        <button class="quick-action" data-shortcut="expenses"><span class="quick-action-icon peach">${icon("expense", 18)}</span><span><strong>비용 기록 입력</strong><small>날짜별 실제 지출</small></span><span class="quick-arrow">${icon("arrow", 16)}</span></button>
        <button class="quick-action" data-shortcut="inventory"><span class="quick-action-icon blue">${icon("stock", 18)}</span><span><strong>재고 변동 기록</strong><small>입고 · 폐기 · 실사</small></span><span class="quick-arrow">${icon("arrow", 16)}</span></button>
      </section>
    </div>
    <div class="sample-notice"><span>${icon("leaf", 17)}</span><p><strong>선택 목록은 확인용 가상 매장 샘플이에요.</strong> 메뉴·재료를 선택할 때 참고하고, 샘플 거래 기록은 가져오지 않았습니다. 저장하는 내용은 로컬 데이터베이스에 보관됩니다.</p></div>`;
}

function emptyState(title, copy, page, action) {
  return `<div class="empty-state"><span class="empty-icon">${icon(page === "inventory" ? "stock" : page === "expenses" ? "expense" : "sales", 22)}</span><strong>${title}</strong><p>${copy}</p><button class="button button-soft" data-shortcut="${page}">${action} ${icon("arrow", 15)}</button></div>`;
}

function renderSales() {
  const sorted = [...state.sales].sort((a, b) => b.date.localeCompare(a.date));
  const netTotal = sorted.reduce((sum, item) => sum + item.netSales, 0);
  if (!sorted.length) return `<div class="summary-strip"><div><span>기록 건수</span><strong>0건</strong></div><div><span>총 수량</span><strong>0개</strong></div><div><span>순매출 합계</span><strong>0원</strong></div></div>${emptyState("판매 기록이 아직 없어요", "하루 · 메뉴 · 채널 단위로 판매 합계를 추가해 보세요.", "sales", "판매 입력")}`;
  return `<div class="summary-strip"><div><span>기록 건수</span><strong>${number(sorted.length)}건</strong></div><div><span>총 수량</span><strong>${number(sorted.reduce((sum, item) => sum + item.quantity, 0))}개</strong></div><div><span>순매출 합계</span><strong>${money(netTotal)}</strong></div><div class="summary-caption">현재 저장된 기록 전체</div></div>
    <section class="panel records-panel"><div class="panel-heading"><div><h2>판매 내역</h2><p>같은 날짜·메뉴·채널은 하나의 합계 기록으로 관리합니다.</p></div><span class="record-count">${number(sorted.length)}건</span></div>
      <div class="table-wrap"><table class="records-table"><thead><tr><th>날짜</th><th>메뉴</th><th>채널</th><th class="align-right">수량</th><th class="align-right">단가</th><th class="align-right">할인</th><th class="align-right">총매출</th><th class="align-right">순매출</th><th class="actions-head">관리</th></tr></thead><tbody>${sorted.map((item) => `<tr><td class="date-cell">${humanDate(item.date)}</td><td><strong>${escapeHtml(item.menuName)}</strong></td><td><span class="tag tag-neutral">${escapeHtml(item.channel)}</span></td><td class="align-right">${number(item.quantity)}개</td><td class="align-right">${money(item.unitPrice)}</td><td class="align-right">${money(item.discountAmount)}</td><td class="align-right">${money(item.grossSales)}</td><td class="align-right amount-cell">${money(item.netSales)}</td><td class="row-actions">${rowButtons("sales", item.id)}</td></tr>`).join("")}</tbody></table></div>
      <div class="panel-foot">결제 수수료 ${money(sorted.reduce((sum, item) => sum + item.paymentFee, 0))} <span> · 메뉴별 직접 원가는 수익성 화면에서 확인할 수 있습니다.</span></div>
    </section>`;
}

function renderExpenses() {
  const sorted = [...state.expenses].sort((a, b) => b.date.localeCompare(a.date));
  const total = sorted.reduce((sum, item) => sum + item.amount, 0);
  if (!sorted.length) return `<div class="summary-strip"><div><span>기록 건수</span><strong>0건</strong></div><div><span>실제 지출 합계</span><strong>0원</strong></div><div class="summary-caption">월별 계획 금액은 합산하지 않습니다.</div></div>${emptyState("비용 기록이 아직 없어요", "실제 지출 날짜와 항목, 금액을 추가해 보세요.", "expenses", "비용 입력")}`;
  return `<div class="summary-strip"><div><span>기록 건수</span><strong>${number(sorted.length)}건</strong></div><div><span>실제 지출 합계</span><strong>${money(total)}</strong></div><div class="summary-caption">월별 계획 금액은 합산하지 않습니다.</div></div>
    <section class="panel records-panel"><div class="panel-heading"><div><h2>비용 내역</h2><p>실제로 지출한 공통 비용이에요.</p></div><span class="record-count">${number(sorted.length)}건</span></div>
      <div class="table-wrap"><table><thead><tr><th>날짜</th><th>비용 항목</th><th class="align-right">금액</th><th class="actions-head">관리</th></tr></thead><tbody>${sorted.map((item) => `<tr><td class="date-cell">${humanDate(item.date)}</td><td><span class="tag tag-expense">${escapeHtml(item.category)}</span></td><td class="align-right amount-cell">${money(item.amount)}</td><td class="row-actions">${rowButtons("expenses", item.id)}</td></tr>`).join("")}</tbody></table></div>
      <div class="panel-foot">비용은 메뉴별로 배분하지 않고 실제 손익의 공통비에 반영합니다.</div>
    </section>`;
}

function renderInventory() {
  const sorted = [...state.inventory].sort((a, b) => b.date.localeCompare(a.date));
  const counts = { restock: 0, waste: 0, stocktake: 0 };
  sorted.forEach((item) => { counts[item.type] += 1; });
  const quickActions = `<div class="inventory-quick-actions"><button class="inventory-quick restock-action" data-action="inventory-add" data-type="restock">${icon("plus", 17)}<span><strong>재료 입고 등록</strong><small>입고 수량 기록 (+)</small></span></button><button class="inventory-quick waste-action" data-action="inventory-add" data-type="waste">${icon("trash", 17)}<span><strong>재료 폐기 등록</strong><small>폐기 수량 기록 (−)</small></span></button><button class="inventory-quick count-action" data-action="inventory-add" data-type="stocktake">${icon("check", 17)}<span><strong>정기 재고 실사</strong><small>실측 수량 기록</small></span></button></div>`;
  if (!sorted.length) return `<div class="summary-strip inventory-summary"><div><span>입고</span><strong>${counts.restock}건</strong></div><div><span>폐기</span><strong>${counts.waste}건</strong></div><div><span>실사</span><strong>${counts.stocktake}건</strong></div><div class="summary-caption">기록 유형별로 따로 보관합니다.</div></div>${quickActions}${emptyState("재고 기록이 아직 없어요", "입고 · 폐기 · 실사 중 하나를 골라 기록해 보세요.", "inventory", "재고 기록 추가")}`;
  return `<div class="summary-strip inventory-summary"><div><span>입고</span><strong>${counts.restock}건</strong></div><div><span>폐기</span><strong>${counts.waste}건</strong></div><div><span>실사</span><strong>${counts.stocktake}건</strong></div><div class="summary-caption">기록 유형별로 따로 보관합니다.</div></div>${quickActions}
    <section class="panel records-panel"><div class="panel-heading"><div><h2>재고 변동 내역</h2><p>실사 수량은 입고·폐기 수량과 구분해 표시합니다.</p></div><span class="record-count">${number(sorted.length)}건</span></div>
      <div class="table-wrap"><table><thead><tr><th>날짜</th><th>재료</th><th>기록 유형</th><th class="align-right">수량</th><th>메모</th><th class="actions-head">관리</th></tr></thead><tbody>${sorted.map((item) => `<tr><td class="date-cell">${humanDate(item.date)}</td><td><strong>${escapeHtml(item.materialName)}</strong></td><td><span class="tag ${item.type === "restock" ? "tag-stock" : item.type === "waste" ? "tag-waste" : "tag-count"}">${eventLabel(item.type)}</span></td><td class="align-right amount-cell">${number(item.quantity, 2)} ${escapeHtml(item.unit)}</td><td class="note-cell">${escapeHtml(item.note || "—")}</td><td class="row-actions">${rowButtons("inventory", item.id)}</td></tr>`).join("")}</tbody></table></div>
      <div class="panel-foot">실사 수량 이후의 입고·폐기·판매 사용량을 반영해 재고 현황과 발주 참고량을 계산합니다.</div>
    </section>`;
}

function monthOptions() {
  const months = new Set([monthOf(today()), state.selectedMonth || monthOf(today())]);
  [...state.sales, ...state.expenses].forEach((item) => months.add(monthOf(item.date)));
  return [...months].sort((a, b) => b.localeCompare(a)).map((month) => {
    const [year, numberPart] = month.split("-");
    return `<option value="${month}" ${month === (state.selectedMonth || monthOf(today())) ? "selected" : ""}>${year}년 ${Number(numberPart)}월</option>`;
  }).join("");
}

function moneyOrDash(value) { return value === null || value === undefined ? "—" : money(value); }

function renderProfitability() {
  if (!state.profitability) return `<div class="insight-loading">${icon("clock", 18)} 수익성 자료를 불러오고 있어요.</div>`;
  const rows = state.profitability.rows || [];
  const completeRows = rows.filter((item) => item.complete);
  const netSales = rows.reduce((sum, item) => sum + item.netSales, 0);
  const directCost = completeRows.reduce((sum, item) => sum + item.directCost, 0);
  const contribution = completeRows.reduce((sum, item) => sum + item.contribution, 0);
  const quantity = rows.reduce((sum, item) => sum + item.quantity, 0);
  const hasRows = rows.length > 0;
  const table = hasRows ? `<section class="panel records-panel"><div class="panel-heading"><div><h2>메뉴 · 채널별 직접 수익성</h2><p>${state.profitability.month} 판매 기록을 기준으로 계산했어요.</p></div><span class="record-count">${number(rows.length)}개 조합</span></div>
      <div class="table-wrap"><table class="insight-table"><thead><tr><th>메뉴</th><th>채널</th><th class="align-right">판매량</th><th class="align-right">순매출</th><th class="align-right">재료비</th><th class="align-right">포장비</th><th class="align-right">수수료</th><th class="align-right">직접비</th><th class="align-right">공헌이익</th><th class="align-right">이익률</th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${escapeHtml(item.menuName)}</strong></td><td>${escapeHtml(item.channel)}</td><td class="align-right">${number(item.quantity)}개</td><td class="align-right">${money(item.netSales)}</td><td class="align-right">${moneyOrDash(item.foodCost)}</td><td class="align-right">${moneyOrDash(item.packagingCost)}</td><td class="align-right">${money(item.paymentFee)}</td><td class="align-right">${moneyOrDash(item.directCost)}</td><td class="align-right amount-cell">${moneyOrDash(item.contribution)}</td><td class="align-right"><span class="margin-pill ${item.marginPercent !== null && item.marginPercent >= 75 ? "margin-good" : ""}">${item.marginPercent === null ? "계산 불가" : `${number(item.marginPercent, 1)}%`}</span></td></tr>`).join("")}</tbody></table></div>
      <div class="panel-foot">재료·포장 원가는 판매 당시 저장한 기준정보 단가를 사용합니다. 임차료·인건비 등 공통비는 이 표에 배분하지 않습니다.</div></section>` : emptyState("이 달의 판매 기록이 없어요", "판매 기록을 입력하면 메뉴·채널별 직접 비용과 공헌이익을 계산합니다.", "sales", "판매 기록 입력");
  return `<div class="summary-strip insight-summary"><div><span>판매 수량</span><strong>${hasRows ? `${number(quantity)}개` : "—"}</strong></div><div><span>순매출</span><strong>${hasRows ? money(netSales) : "—"}</strong></div><div><span>직접 비용</span><strong>${hasRows ? money(directCost) : "—"}</strong></div><div><span>공헌이익</span><strong>${hasRows ? money(contribution) : "—"}</strong></div></div>
    <div class="formula-example"><div><span class="formula-label">계획서 검산 예시 · 실제 매장 기록이 아닌 계산 확인용</span><strong>4,091원 − (522원 + 110원 + 115원) = 3,344원</strong><small>개당 공헌이익률 81.7% · 5개 판매 시 합계 공헌이익 16,720원</small></div><span class="formula-badge">순매출 − 재료비 − 포장비 − 결제 수수료</span></div>
    ${rows.some((item) => !item.complete) ? `<div class="callout insight-warning"><span>${icon("leaf", 16)}</span><p>원가 기준이 없는 ${number(rows.filter((item) => !item.complete).reduce((sum, item) => sum + item.missingCostRows, 0))}건은 공헌이익 계산에서 제외하고 기준정보 확인이 필요하다고 표시합니다.</p></div>` : ""}
    ${table}<p class="source-note">메뉴·재료·레시피·가격은 가상 매장 샘플 기준정보를 참고합니다. 샘플 거래 기록은 가져오지 않았습니다.</p>`;
}

function renderPnl() {
  if (!state.pnl) return `<div class="insight-loading">${icon("clock", 18)} 손익 자료를 불러오고 있어요.</div>`;
  const item = state.pnl;
  const value = (amount) => !item.hasData ? "자료 없음" : !item.hasSales ? "판매 기록 없음" : moneyOrDash(amount);
  const status = !item.hasData ? `<div class="callout insight-warning"><span>${icon("calendar", 16)}</span><p>선택한 달에는 판매 또는 비용 기록이 없습니다. 기록이 없는 기간을 0원 실적으로 간주하지 않습니다.</p></div>` : !item.hasSales ? `<div class="callout insight-warning"><span>${icon("calendar", 16)}</span><p>선택한 달에는 비용 기록만 있습니다. 판매 자료가 없으므로 영업이익 계산을 보류했습니다.</p></div>` : item.missingCostRows ? `<div class="callout insight-warning"><span>${icon("leaf", 16)}</span><p>판매 ${number(item.missingCostRows)}건에 직접 원가 기준이 없어 영업이익 계산을 보류했습니다.</p></div>` : "";
  return `${status}<div class="summary-strip insight-summary"><div><span>순매출</span><strong>${value(item.netSales)}</strong></div><div><span>직접 비용</span><strong>${value(item.directCost)}</strong></div><div><span>공통비</span><strong>${value(item.commonCost)}</strong></div><div class="profit-summary"><span>영업이익</span><strong>${value(item.operatingProfit)}</strong></div></div>
    <div class="formula-example"><div><span class="formula-label">계획서 검산 예시 · 실제 매장 기록이 아닌 계산 확인용</span><strong>600원 − 250원 − 120원 = 230원</strong><small>순매출 − 직접 비용 − 공통비 = 영업이익</small></div></div>
    <section class="panel pnl-panel"><div class="panel-heading"><div><h2>${item.month} 실제 손익</h2><p>판매 기록과 실제 비용 기록을 집계했습니다. 예상 손익은 이 Epic 범위에 포함하지 않습니다.</p></div><span class="record-count">판매 ${number(item.salesCount)}건 · 비용 ${number(item.expenseCount)}건</span></div>
      <div class="pnl-lines"><div><span>순매출 <small>총매출 − 할인</small></span><strong>${value(item.netSales)}</strong></div><div><span>메뉴 재료비</span><strong>− ${value(item.foodCost)}</strong></div><div><span>메뉴 포장비</span><strong>− ${value(item.packagingCost)}</strong></div><div><span>결제 수수료</span><strong>− ${value(item.paymentFee)}</strong></div><div class="pnl-subtotal"><span>공헌이익</span><strong>${value(item.contribution)}</strong></div><div><span>공통비 실제 지출</span><strong>${item.hasData ? money(item.commonCost) : "자료 없음"}</strong></div><div class="pnl-total"><span>영업이익 <small>공통비를 메뉴별로 나누지 않음</small></span><strong>${value(item.operatingProfit)}</strong></div></div>
      <div class="panel-foot">월별 비용 계획은 실제 지출과 중복될 수 있어 실제 손익에 합산하지 않습니다. 손익 집계는 선택 월의 날짜별 기록을 사용합니다.</div></section>`;
}

function renderStockBalance() {
  if (!state.inventoryBalance) return `<div class="insight-loading">${icon("clock", 18)} 재고 잔량을 계산하고 있어요.</div>`;
  const rows = state.inventoryBalance.rows || [];
  const counted = rows.filter((item) => item.balance !== null);
  const order = counted.filter((item) => item.orderPacks > 0);
  const table = `<section class="panel records-panel"><div class="panel-heading"><div><h2>재료별 예상 잔량과 발주 참고</h2><p>${humanDate(state.inventoryBalance.asOf)} 기준 · 최근 실사 이후 수량만 반영</p></div><span class="record-count">${number(rows.length)}개 재료</span></div>
      <div class="table-wrap"><table class="insight-table stock-table"><thead><tr><th>재료 · 단위</th><th>최근 실사</th><th class="align-right">이후 입고</th><th class="align-right">이후 폐기</th><th class="align-right">판매 사용</th><th class="align-right">예상 잔량</th><th class="align-right">하루 사용</th><th class="align-right">목표 재고</th><th class="align-right">발주 참고</th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${escapeHtml(item.materialName)}</strong><span class="sub-cell">${escapeHtml(item.unit)}</span></td><td>${item.lastStocktakeDate ? `${humanDate(item.lastStocktakeDate)} · ${number(item.lastStocktakeQuantity, 2)} ${escapeHtml(item.unit)}` : `<span class="missing-baseline">실사 기록 없음</span>`}</td><td class="align-right">${item.balance === null ? "—" : `+${number(item.restocked, 2)} ${escapeHtml(item.unit)}`}</td><td class="align-right">${item.balance === null ? "—" : `−${number(item.wasted, 2)} ${escapeHtml(item.unit)}`}</td><td class="align-right">${item.balance === null ? "—" : `−${number(item.salesUsage, 2)} ${escapeHtml(item.unit)}`}</td><td class="align-right ${item.balance !== null && item.balance < 0 ? "negative-balance" : "amount-cell"}">${item.balance === null ? "—" : `${number(item.balance, 2)} ${escapeHtml(item.unit)}`}</td><td class="align-right">${item.dailyUsage === null ? "—" : `${number(item.dailyUsage, 2)} ${escapeHtml(item.unit)}`}</td><td class="align-right">${item.targetStock === null ? "—" : `${number(item.targetStock, 2)} ${escapeHtml(item.unit)}`}</td><td class="align-right">${item.orderPacks === null ? "—" : `<span class="order-pill ${item.orderPacks ? "order-needed" : ""}">${number(item.orderPacks)}포장</span>`}</td></tr>`).join("")}</tbody></table></div>
      <div class="panel-foot">발주 참고량 = 목표 재고(하루 평균 사용량 × 납기·안전재고 일수)에서 잔량을 뺀 부족량을 포장 단위로 올림합니다. 자동 발주가 아닙니다.</div></section>`;
  return `<div class="summary-strip insight-summary"><div><span>관리 재료</span><strong>${number(rows.length)}종</strong></div><div><span>실사 기준 확인</span><strong>${number(counted.length)}종</strong></div><div><span>발주 참고 있음</span><strong>${number(order.length)}종</strong></div><div class="summary-caption">실사 기록이 없는 재료는 잔량을 계산하지 않아요.</div></div>
    <div class="formula-example"><div><span class="formula-label">계획서 검산 예시 · 실제 매장 기록이 아닌 계산 확인용</span><strong>실사 300 + 입고 100 − 폐기 50 − 판매사용 150 = 잔량 200ml</strong><small>하루 100ml × (납기 2일 + 안전재고 2일) = 목표 400ml · 부족 200ml → 1포장</small></div></div>
    <div class="inventory-actions-inline"><button class="button button-soft" data-shortcut="inventory">${icon("stock", 16)} 실사·입고·폐기 기록 보기</button></div>${table}
    <p class="source-note">평균 사용량은 최근 실사 이후 경과한 달력일을 기준으로 계산합니다. 납기·안전재고·포장량은 가상 샘플 기준정보 참고값입니다.</p>`;
}

function eventLabel(type) {
  return ({ restock: "입고", waste: "폐기", stocktake: "실사" })[type] || type;
}

function rowButtons(kind, id) {
  return `<button class="icon-button" data-kind="${kind}" data-edit="${escapeHtml(id)}" aria-label="기록 수정">${icon("edit", 16)}</button><button class="icon-button danger" data-kind="${kind}" data-delete="${escapeHtml(id)}" aria-label="기록 삭제">${icon("trash", 16)}</button>`;
}

function openRecordForm(kind, item = null, initialType = null) {
  if (!["sales", "expenses", "inventory"].includes(kind)) return;
  const modalRoot = document.querySelector("#modal-root");
  const title = item ? "기록 수정" : kind === "inventory" && initialType ? `${eventLabel(initialType)} 기록 추가` : ({ sales: "판매 기록 입력", expenses: "비용 기록 입력", inventory: "재고 기록 추가" })[kind];
  modalRoot.innerHTML = `<div class="modal-backdrop" data-close-modal><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-heading"><div><p class="eyebrow">${kind === "sales" ? "SALES ENTRY" : kind === "expenses" ? "EXPENSE ENTRY" : "INVENTORY ENTRY"}</p><h2 id="modal-title">${title}</h2><p>${modalSubcopy(kind)}</p></div><button class="icon-button modal-close" type="button" data-close-modal aria-label="닫기">${icon("close", 18)}</button></div><form id="record-form" class="record-form" novalidate>${recordFields(kind, item, initialType)}<p class="form-error" id="form-error" hidden></p><div class="modal-actions"><button class="button button-quiet" type="button" data-close-modal>취소</button><button class="button button-primary" type="submit">${item ? "변경 저장" : "기록 저장"}</button></div></form></section></div>`;
  modalRoot.querySelectorAll("[data-close-modal]").forEach((node) => node.addEventListener("click", (event) => {
    if (event.target === node || node.tagName === "BUTTON") modalRoot.innerHTML = "";
  }));
  const form = modalRoot.querySelector("#record-form");
  form.addEventListener("submit", (event) => submitRecord(event, kind, item));
  if (kind === "sales") {
    form.querySelector("[name=menuId]").addEventListener("change", (event) => {
      const menu = state.catalog.menus.find((entry) => entry.id === event.target.value);
      const priceField = form.querySelector("[name=unitPrice]");
      if (menu && (!priceField.value || priceField.dataset.auto === "true")) {
        priceField.value = menu.price;
        priceField.dataset.auto = "true";
      }
      priceField.addEventListener("input", () => { priceField.dataset.auto = "false"; }, { once: true });
    });
  }
  if (kind === "inventory") {
    form.querySelector("[name=materialId]").addEventListener("change", (event) => {
      const material = state.catalog.materials.find((entry) => entry.id === event.target.value);
      form.querySelector(".input-suffix > span").textContent = material?.unit || "단위";
    });
  }
  modalRoot.querySelector("input, select")?.focus();
}

function modalSubcopy(kind) {
  if (kind === "sales") return "하루 · 메뉴 · 채널별 합계로 입력합니다.";
  if (kind === "expenses") return "실제로 지출한 금액을 입력합니다.";
  return "입고, 폐기, 실제 재고 실사를 구분해 기록합니다.";
}

function recordFields(kind, item, initialType = null) {
  if (kind === "sales") {
    return `<div class="form-grid"><label class="field"><span>날짜 <b>*</b></span><input type="date" name="date" value="${escapeHtml(item?.date || today())}" required></label>
      <label class="field"><span>판매 채널 <b>*</b></span><select name="channel" required><option value="">선택해 주세요</option>${state.catalog.channels.map((name) => `<option value="${escapeHtml(name)}" ${item?.channel === name ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}</select></label>
      <label class="field"><span>메뉴 <b>*</b></span><select name="menuId" required><option value="">선택해 주세요</option>${state.catalog.menus.map((menu) => `<option value="${escapeHtml(menu.id)}" ${item?.menuId === menu.id ? "selected" : ""}>${escapeHtml(menu.name)}</option>`).join("")}</select><small class="field-hint">가상 샘플 메뉴 목록</small></label>
      <label class="field"><span>수량 <b>*</b></span><div class="input-suffix"><input type="number" name="quantity" min="0" step="1" value="${item ? item.quantity : ""}" placeholder="예: 5" required><span>개</span></div></label>
      <label class="field"><span>단가 <b>*</b></span><div class="input-suffix"><input type="number" name="unitPrice" min="0" step="1" value="${item ? item.unitPrice : ""}" placeholder="예: 4,000" required><span>원</span></div></label>
      <label class="field"><span>할인 금액</span><div class="input-suffix"><input type="number" name="discountAmount" min="0" step="1" value="${item ? item.discountAmount : 0}" required><span>원</span></div></label>
      <label class="field"><span>결제 수수료</span><div class="input-suffix"><input type="number" name="paymentFee" min="0" step="1" value="${item ? item.paymentFee : 0}" required><span>원</span></div><small class="field-hint">입력한 판매일의 재료·포장 원가와 함께 저장됩니다.</small></label></div>
      <div class="calculation-hint"><span>${icon("sales", 17)}</span><div><small>할인 전 총매출</small><strong id="gross-preview">—</strong></div><span class="hint-minus">−</span><div><small>할인 적용 후 순매출</small><strong id="net-preview">—</strong></div></div>`;
  }
  if (kind === "expenses") {
    return `<div class="form-grid"><label class="field"><span>날짜 <b>*</b></span><input type="date" name="date" value="${escapeHtml(item?.date || today())}" required></label>
      <label class="field"><span>비용 항목 <b>*</b></span><select name="category" required><option value="">선택해 주세요</option>${state.catalog.expense_categories.map((category) => `<option value="${escapeHtml(category)}" ${item?.category === category ? "selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select></label>
      <label class="field field-full"><span>금액 <b>*</b></span><div class="input-suffix"><input type="number" name="amount" min="0" step="1" value="${item ? item.amount : ""}" placeholder="예: 120,000" required><span>원</span></div></label></div>
      <div class="callout subtle-callout"><span>${icon("leaf", 16)}</span><p>여기에 입력하는 금액은 실제 지출 기록입니다. 월별 비용 계획과 중복해 합산하지 않습니다.</p></div>`;
  }
  const selectedType = item?.type || initialType || "restock";
  const selectedMaterial = state.catalog.materials.find((material) => material.id === item?.materialId);
  return `<div class="form-grid"><label class="field"><span>날짜 <b>*</b></span><input type="date" name="date" value="${escapeHtml(item?.date || today())}" required></label>
      <label class="field"><span>기록 유형 <b>*</b></span><select name="type" required><option value="restock" ${selectedType === "restock" ? "selected" : ""}>입고</option><option value="waste" ${selectedType === "waste" ? "selected" : ""}>폐기</option><option value="stocktake" ${selectedType === "stocktake" ? "selected" : ""}>실사</option></select></label>
      <label class="field"><span>재료 <b>*</b></span><select name="materialId" required><option value="">선택해 주세요</option>${state.catalog.materials.map((material) => `<option value="${escapeHtml(material.id)}" ${item?.materialId === material.id ? "selected" : ""}>${escapeHtml(material.name)} · ${escapeHtml(material.unit)}</option>`).join("")}</select><small class="field-hint">가상 샘플 재료 목록</small></label>
      <label class="field"><span id="quantity-label">${selectedType === "stocktake" ? "실측 수량" : "수량"} <b>*</b></span><div class="input-suffix"><input type="number" name="quantity" min="0" step="0.01" value="${item ? item.quantity : ""}" placeholder="예: 250" required><span>${escapeHtml(selectedMaterial?.unit || "단위")}</span></div></label>
      <label class="field field-full"><span>메모</span><input type="text" name="note" maxlength="300" value="${escapeHtml(item?.note || "")}" placeholder="사유나 참고 내용을 입력해 주세요"></label></div>
      <div class="callout subtle-callout"><span>${icon("stock", 16)}</span><p>실사는 현재 실제로 센 수량을 입력합니다. 이후 변동과 판매 사용량은 재고 현황에서 확인합니다.</p></div>`;
}

function editRecord(kind, id) {
  const collection = kind === "sales" ? state.sales : kind === "expenses" ? state.expenses : state.inventory;
  const item = collection.find((record) => record.id === id);
  if (item) openRecordForm(kind, item);
}

async function submitRecord(event, kind, item) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  data.date = String(data.date || "");
  if (kind === "sales") {
    data.quantity = Number(data.quantity);
    data.unitPrice = Number(data.unitPrice);
    data.discountAmount = Number(data.discountAmount);
    data.paymentFee = Number(data.paymentFee);
  }
  if (kind === "expenses") data.amount = Number(data.amount);
  if (kind === "inventory") data.quantity = Number(data.quantity);
  if (item) data.id = item.id;
  const button = form.querySelector("button[type=submit]");
  const errorNode = form.querySelector("#form-error");
  errorNode.hidden = true;
  button.disabled = true;
  button.innerHTML = `<span class="spinner"></span> 저장 중`;
  try {
    await api(`/api/${kind}`, { method: item ? "PUT" : "POST", body: data });
    await refreshRecords();
    state.page = kind;
    renderApp();
    toast(item ? "변경 사항을 저장했습니다." : "기록을 저장했습니다.");
  } catch (error) {
    errorNode.textContent = error.message;
    errorNode.hidden = false;
    button.disabled = false;
    button.textContent = item ? "변경 저장" : "기록 저장";
    if (error.field) form.querySelector(`[name="${CSS.escape(error.field)}"]`)?.focus();
  }
}

async function deleteRecord(kind, id) {
  const collection = kind === "sales" ? state.sales : kind === "expenses" ? state.expenses : state.inventory;
  const item = collection.find((record) => record.id === id);
  const label = kind === "sales" ? `${item?.menuName || "판매"} 판매 기록` : kind === "expenses" ? `${item?.category || "비용"} 기록` : `${item?.materialName || "재고"} ${eventLabel(item?.type || "")}`;
  if (!window.confirm(`${label}을 삭제할까요? 삭제한 기록은 복구할 수 없습니다.`)) return;
  try {
    await api(`/api/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshRecords();
    renderApp();
    toast("기록을 삭제했습니다.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: {} });
    state.status = await api("/api/status");
    renderAuth();
    toast("로그아웃했습니다.");
  } catch (error) {
    toast(error.message, "error");
  }
}

document.addEventListener("input", (event) => {
  const form = event.target.closest("#record-form");
  if (!form || !form.querySelector("[name=quantity]") || !form.querySelector("[name=unitPrice]")) return;
  const qty = Number(form.querySelector("[name=quantity]").value);
  const unitPrice = Number(form.querySelector("[name=unitPrice]").value);
  const discount = Number(form.querySelector("[name=discountAmount]").value || 0);
  const gross = qty * unitPrice;
  const grossNode = form.querySelector("#gross-preview");
  const netNode = form.querySelector("#net-preview");
  if (grossNode) grossNode.textContent = money(gross);
  if (netNode) netNode.textContent = money(Math.max(gross - discount, 0));
});

document.addEventListener("change", (event) => {
  const form = event.target.closest("#record-form");
  if (!form || event.target.name !== "type") return;
  const label = form.querySelector("#quantity-label");
  if (label) label.innerHTML = `${event.target.value === "stocktake" ? "실측 수량" : "수량"} <b>*</b>`;
});

initialize();
