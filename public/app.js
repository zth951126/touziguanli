/**
 * 前端逻辑
 */

const content = document.getElementById('content');
const updatedAtEl = document.getElementById('updatedAt');
const refreshBtn = document.getElementById('refreshBtn');
const tabs = document.querySelectorAll('.tab');
const modal = document.getElementById('detailModal');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const closeModal = document.querySelector('.close');
const newsList = document.getElementById('newsList');
const newsTabs = document.querySelectorAll('.news-tab');

let currentData = { all: [], funds: [], 'offsite-funds': [], portfolio: [] };
let currentTab = 'all';
let currentNews = { all: [], domestic: [], international: [] };
let currentNewsTab = 'all';
let portfolio = JSON.parse(localStorage.getItem('fundPortfolio') || '[]');

function classify(item) {
  if (item.error) return 'hold';
  if (item.score >= 3) return 'buy';
  if (item.score <= -2) return 'sell';
  if (item.score > 0) return 'buy';
  return 'hold';
}

function formatPct(v) {
  if (v === undefined || v === null) return '-';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function renderCard(item) {
  const cls = classify(item);
  const kindLabel = item.kind || '标的';
  if (item.error) {
    return `
      <div class="card hold">
        <div class="card-header">
          <div>
            <div class="card-title">${item.name}</div>
            <div class="card-code">${item.code} · ${kindLabel}${item.type ? ' · ' + item.type : ''}</div>
          </div>
          <span class="badge hold">数据异常</span>
        </div>
        <div class="card-body"><p>${item.error}</p></div>
      </div>
    `;
  }
  const ind = item.indicators || {};
  const indHtml = Object.keys(ind).length ? `
    <div class="indicators">
      <div class="indicator"><span>MA5</span><span>${ind.ma5}</span></div>
      <div class="indicator"><span>MA20</span><span>${ind.ma20}</span></div>
      <div class="indicator"><span>MACD</span><span>${ind.macd}</span></div>
      <div class="indicator"><span>RSI(14)</span><span>${ind.rsi}</span></div>
      <div class="indicator"><span>K/D</span><span>${ind.k}/${ind.d}</span></div>
      <div class="indicator"><span>布林上轨/下轨</span><span>${ind.bollUpper}/${ind.bollLower}</span></div>
    </div>
  ` : '';
  return `
    <div class="card ${cls}">
      <div class="card-header">
        <div>
          <div class="card-title">${item.name}</div>
          <div class="card-code">${item.code} · ${kindLabel}${item.type ? ' · ' + item.type : ''}</div>
        </div>
        <span class="badge ${cls}">${item.action}</span>
      </div>
      <div class="card-body">
        <p><span class="label">当前价：</span>¥${item.price ?? '-'} <span style="color:${(item.pctChange||0)>=0?'var(--buy)':'var(--sell)'}">${formatPct(item.pctChange)}</span></p>
        <p><span class="label">综合评分：</span><span class="score ${cls}">${item.score > 0 ? '+' : ''}${item.score}</span></p>
        <p><span class="label">操作建议：</span>${item.position}</p>
        <div class="reason"><strong>信号：</strong>${item.reason}</div>
        ${indHtml}
      </div>
      ${item.kind === '基金' ? `<button class="detail-btn" data-code="${item.code}">查看 K 线详情</button>` : ''}
    </div>
  `;
}

function getPortfolioAdvice(item, holding) {
  const score = item.score || 0;
  const profit = holding.profit;
  const isProfit = profit >= 0;
  const isLoss = profit < 0;

  if (score >= 4) {
    if (isLoss) return { action: '强烈加仓', reason: '技术信号强烈看多，当前浮亏，可考虑补仓摊薄成本。', cls: 'buy' };
    return { action: '继续持有', reason: '技术信号强烈看多，已有盈利，继续持有。', cls: 'buy' };
  }
  if (score >= 2) {
    if (isLoss) return { action: '逢低加仓', reason: '技术信号偏多，当前浮亏，可小仓位补仓。', cls: 'buy' };
    return { action: '持有', reason: '技术信号偏多，已有盈利，继续持有。', cls: 'buy' };
  }
  if (score > 0) {
    if (isLoss) return { action: '关注加仓', reason: '出现初步买入信号，当前浮亏，可小额试探加仓。', cls: 'buy' };
    return { action: '持有观望', reason: '信号一般，已有盈利，暂持有观望。', cls: 'hold' };
  }
  if (score === 0) {
    return { action: '观望', reason: '技术信号不明显，建议保持现有仓位观望。', cls: 'hold' };
  }
  if (score >= -3) {
    if (isProfit) return { action: '减仓止盈', reason: '技术信号转弱，已有盈利，建议分批减仓止盈。', cls: 'sell' };
    return { action: '关注止损', reason: '技术信号偏弱，当前浮亏，关注是否跌破止损位。', cls: 'hold' };
  }
  if (isProfit) return { action: '清仓止盈', reason: '技术信号强烈看空，已有盈利，建议清仓或大幅减仓。', cls: 'sell' };
  return { action: '止损离场', reason: '技术信号强烈看空，当前浮亏，建议止损避免扩大损失。', cls: 'sell' };
}

function renderPortfolio() {
  if (!portfolio.length) {
    content.innerHTML = `
      <div class="portfolio-form">
        <h3>➕ 添加持仓</h3>
        ${portfolioFormHtml()}
      </div>
      <div class="portfolio-empty">暂无持仓，请先添加您持有的基金。</div>
    `;
    bindPortfolioForm();
    updateSummary();
    return;
  }

  // 匹配推荐数据
  const portfolioData = portfolio.map(h => {
    const found = currentData.all.find(i => i.code === h.code) || currentData.funds.find(i => i.code === h.code);
    if (found && !found.error) {
      const marketValue = h.shares * found.price;
      const costValue = h.shares * h.cost;
      const profit = marketValue - costValue;
      const profitPct = (profit / costValue) * 100;
      const advice = getPortfolioAdvice(found, { profit: profitPct });
      return { ...found, holding: { ...h, marketValue, profit, profitPct }, advice };
    }
    return { code: h.code, name: h.name, holding: h, error: '未找到行情数据' };
  });

  const totalCost = portfolioData.reduce((sum, i) => sum + (i.holding ? i.holding.shares * i.holding.cost : 0), 0);
  const totalValue = portfolioData.reduce((sum, i) => sum + (i.holding ? i.holding.marketValue || 0 : 0), 0);
  const totalProfit = totalValue - totalCost;
  const totalProfitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

  const summaryHtml = `
    <div class="portfolio-form">
      <h3>📊 持仓概览</h3>
      <p><span class="label">总市值：</span>¥${totalValue.toFixed(2)} &nbsp; <span class="label">总成本：</span>¥${totalCost.toFixed(2)} &nbsp; <span class="label">总盈亏：</span><span class="${totalProfit >= 0 ? 'profit' : 'loss'}">${totalProfit >= 0 ? '+' : ''}¥${totalProfit.toFixed(2)} (${formatPct(totalProfitPct)})</span></p>
    </div>
    <div class="portfolio-form">
      <h3>➕ 添加持仓</h3>
      ${portfolioFormHtml()}
    </div>
  `;

  const cardsHtml = `<div class="grid">${portfolioData.map(item => {
    if (item.error) {
      return `
        <div class="card hold">
          <div class="card-header">
            <div>
              <div class="card-title">${item.name}</div>
              <div class="card-code">${item.code}</div>
            </div>
            <button class="delete-btn" data-code="${item.code}">删除</button>
          </div>
          <div class="card-body"><p>${item.error}</p></div>
        </div>
      `;
    }
    const h = item.holding;
    const ind = item.indicators || {};
    return `
      <div class="card ${item.advice.cls}">
        <div class="card-header">
          <div>
            <div class="card-title">${item.name}</div>
            <div class="card-code">${item.code} · ${item.type}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="badge ${item.advice.cls}">${item.advice.action}</span>
            <button class="delete-btn" data-code="${item.code}">删除</button>
          </div>
        </div>
        <div class="card-body">
          <p><span class="label">持仓成本：</span>¥${h.cost.toFixed(3)} × ${h.shares} 份</p>
          <p><span class="label">当前价：</span>¥${item.price.toFixed(3)} <span style="color:${item.pctChange>=0?'var(--buy)':'var(--sell)'}">${formatPct(item.pctChange)}</span></p>
          <p><span class="label">持仓盈亏：</span><span class="${h.profit >= 0 ? 'profit' : 'loss'} profit-loss">${h.profit >= 0 ? '+' : ''}¥${h.profit.toFixed(2)} (${formatPct(h.profitPct)})</span></p>
          <p><span class="label">持仓市值：</span>¥${h.marketValue.toFixed(2)}</p>
          <p><span class="label">综合评分：</span><span class="score ${classify(item)}">${item.score > 0 ? '+' : ''}${item.score}</span></p>
          <div class="hold-advice"><strong>个性化建议：</strong>${item.advice.reason}</div>
          <div class="reason"><strong>技术信号：</strong>${item.reason}</div>
          <div class="indicators">
            <div class="indicator"><span>MA5</span><span>${ind.ma5}</span></div>
            <div class="indicator"><span>MA20</span><span>${ind.ma20}</span></div>
            <div class="indicator"><span>MACD</span><span>${ind.macd}</span></div>
            <div class="indicator"><span>RSI</span><span>${ind.rsi}</span></div>
            <div class="indicator"><span>K/D</span><span>${ind.k}/${ind.d}</span></div>
            <div class="indicator"><span>布林上/下轨</span><span>${ind.bollUpper}/${ind.bollLower}</span></div>
          </div>
        </div>
        <button class="detail-btn" data-code="${item.code}">查看 K 线详情</button>
      </div>
    `;
  }).join('')}</div>`;

  content.innerHTML = summaryHtml + cardsHtml;
  bindPortfolioForm();
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => deleteHolding(btn.dataset.code));
  });
  document.querySelectorAll('.detail-btn').forEach(btn => {
    btn.addEventListener('click', () => showDetail(btn.dataset.code));
  });

  // summary 只统计有基金的持仓建议
  let buy = 0, hold = 0, sell = 0;
  portfolioData.filter(i => !i.error).forEach(i => {
    if (i.advice.cls === 'buy') buy++;
    else if (i.advice.cls === 'sell') sell++;
    else hold++;
  });
  document.getElementById('buyCount').textContent = buy;
  document.getElementById('holdCount').textContent = hold;
  document.getElementById('sellCount').textContent = sell;
}

function portfolioFormHtml() {
  return `
    <div class="form-row">
      <input type="text" id="pCode" placeholder="基金代码，如 518880" />
      <input type="text" id="pName" placeholder="基金名称，如 黄金ETF" />
      <input type="number" id="pCost" placeholder="成本价（元）" step="0.0001" />
      <input type="number" id="pShares" placeholder="持有份额" step="0.01" />
    </div>
    <button id="addPortfolio" class="btn btn-primary">添加持仓</button>
  `;
}

function bindPortfolioForm() {
  const btn = document.getElementById('addPortfolio');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const code = document.getElementById('pCode').value.trim();
    const name = document.getElementById('pName').value.trim();
    const cost = parseFloat(document.getElementById('pCost').value);
    const shares = parseFloat(document.getElementById('pShares').value);
    if (!code || !name || isNaN(cost) || isNaN(shares) || cost <= 0 || shares <= 0) {
      alert('请填写完整的持仓信息');
      return;
    }
    if (portfolio.find(h => h.code === code)) {
      alert('该基金已存在');
      return;
    }
    portfolio.push({ code, name, cost, shares });
    savePortfolio();
    renderPortfolio();
  });
}

function deleteHolding(code) {
  portfolio = portfolio.filter(h => h.code !== code);
  savePortfolio();
  renderPortfolio();
}

function savePortfolio() {
  localStorage.setItem('fundPortfolio', JSON.stringify(portfolio));
}

function updateSummary() {
  const data = currentData[currentTab] || [];
  let buy = 0, hold = 0, sell = 0;
  data.forEach(item => {
    const cls = classify(item);
    if (cls === 'buy') buy++;
    else if (cls === 'sell') sell++;
    else hold++;
  });
  document.getElementById('buyCount').textContent = buy;
  document.getElementById('holdCount').textContent = hold;
  document.getElementById('sellCount').textContent = sell;
}

function render() {
  if (currentTab === 'portfolio') {
    renderPortfolio();
    return;
  }
  const data = currentData[currentTab] || [];
  if (!data.length) {
    content.innerHTML = '<div class="loading">暂无数据</div>';
    return;
  }
  content.innerHTML = `<div class="grid">${data.map(renderCard).join('')}</div>`;
  document.querySelectorAll('.detail-btn').forEach(btn => {
    btn.addEventListener('click', () => showDetail(btn.dataset.code));
  });
  updateSummary();
}

function renderNews() {
  const data = currentNews[currentNewsTab] || [];
  if (!data.length) {
    newsList.innerHTML = '<li class="news-loading">暂无新闻</li>';
    return;
  }
  newsList.innerHTML = data.map(n => `
    <li>
      <a href="${n.url}" target="_blank" rel="noopener">${n.title}</a>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="tag">${n.tag}</span>
        <span class="time">${n.time}</span>
      </div>
    </li>
  `).join('');
}

async function loadNews() {
  try {
    const res = await fetch('/api/news');
    const json = await res.json();
    currentNews = {
      all: json.all || [],
      domestic: json.domestic || [],
      international: json.international || []
    };
    renderNews();
  } catch (err) {
    newsList.innerHTML = `<li class="news-loading">新闻加载失败：${err.message}</li>`;
  }
}

async function loadData(force = false) {
  content.innerHTML = '<div class="loading">正在计算今日推荐策略，请稍候...</div>';
  try {
    const endpoints = ['all', 'funds', 'offsite-funds'];
    const results = await Promise.all(endpoints.map(async ep => {
      const url = ep === 'offsite-funds' ? '/api/offsite-funds' : `/api/${ep}`;
      const res = await fetch(url + (force ? '?t=' + Date.now() : ''));
      return { ep, json: await res.json() };
    }));
    results.forEach(({ ep, json }) => {
      currentData[ep] = json.data || [];
    });
    const first = results.find(r => r.json.updatedAt);
    updatedAtEl.textContent = '更新时间：' + new Date(first.json.updatedAt).toLocaleString('zh-CN');
    render();
  } catch (err) {
    content.innerHTML = `<div class="loading" style="color:var(--sell)">加载失败：${err.message}</div>`;
  }
}

async function refresh() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = '刷新中...';
  try {
    await fetch('/api/refresh?t=' + Date.now());
    await Promise.all([loadData(true), loadNews()]);
  } catch (err) {
    content.innerHTML = `<div class="loading" style="color:var(--sell)">刷新失败：${err.message}</div>`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 刷新数据';
  }
}

async function showDetail(code) {
  modalTitle.textContent = code + ' 详细分析';
  modalBody.innerHTML = '<div class="loading">加载中...</div>';
  modal.classList.add('open');
  try {
    const res = await fetch(`/api/detail/${code}`);
    const data = await res.json();
    if (data.error) {
      modalBody.innerHTML = `<p style="color:var(--sell)">${data.error}</p>`;
      return;
    }
    const ind = data.indicators || {};
    const klines = data.klines || [];
    let chartHtml = '<h3>近 30 日收盘价走势</h3><div style="overflow-x:auto;">';
    if (klines.length) {
      const max = Math.max(...klines.map(k => k.high));
      const min = Math.min(...klines.map(k => k.low));
      const range = max - min || 1;
      chartHtml += '<div style="display:flex;align-items:flex-end;gap:4px;height:160px;padding:10px 0;border-bottom:1px solid var(--border);">';
      klines.forEach(k => {
        const h = Math.max(4, ((k.close - min) / range) * 140);
        const color = k.close >= k.open ? 'var(--buy)' : 'var(--sell)';
        chartHtml += `<div title="${k.date} 收:${k.close}" style="flex:1;background:${color};border-radius:2px 2px 0 0;height:${h}px;min-width:4px;"></div>`;
      });
      chartHtml += '</div>';
      chartHtml += `<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--muted);margin-top:4px;">
        <span>${klines[0].date}</span><span>${klines[klines.length-1].date}</span>
      </div>`;
    }
    chartHtml += '</div>';

    modalBody.innerHTML = `
      <p><strong>${data.name} (${data.code})</strong> · ${data.date} · 评分 ${data.score}</p>
      <p><span class="label">操作建议：</span><span class="badge ${classify(data)}">${data.action}</span> ${data.position}</p>
      <p><span class="label">当前价：</span>¥${data.price}</p>
      <p><span class="label">趋势：</span>${data.trend || '-'}</p>
      <div class="reason"><strong>信号：</strong>${data.reason}</div>
      <h3>关键指标</h3>
      <div class="indicators" style="grid-template-columns: repeat(3, 1fr);font-size:0.9rem;">
        <div class="indicator"><span>MA5</span><span>${ind.ma5}</span></div>
        <div class="indicator"><span>MA10</span><span>${ind.ma10}</span></div>
        <div class="indicator"><span>MA20</span><span>${ind.ma20}</span></div>
        <div class="indicator"><span>MA60</span><span>${ind.ma60}</span></div>
        <div class="indicator"><span>DIF</span><span>${ind.dif}</span></div>
        <div class="indicator"><span>DEA</span><span>${ind.dea}</span></div>
        <div class="indicator"><span>MACD</span><span>${ind.macd}</span></div>
        <div class="indicator"><span>RSI(14)</span><span>${ind.rsi}</span></div>
        <div class="indicator"><span>K / D / J</span><span>${ind.k} / ${ind.d} / ${ind.j}</span></div>
        <div class="indicator"><span>布林上轨</span><span>${ind.bollUpper}</span></div>
        <div class="indicator"><span>布林下轨</span><span>${ind.bollLower}</span></div>
      </div>
      ${chartHtml}
    `;
  } catch (err) {
    modalBody.innerHTML = `<p style="color:var(--sell)">加载失败：${err.message}</p>`;
  }
}

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentTab = tab.dataset.tab;
    render();
  });
});

newsTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    newsTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    currentNewsTab = tab.dataset.news;
    renderNews();
  });
});

refreshBtn.addEventListener('click', refresh);
closeModal.addEventListener('click', () => modal.classList.remove('open'));
modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('open'); });

loadData();
loadNews();
