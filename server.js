/**
 * 行业主题基金每日推荐服务
 * 启动：node server.js
 * 访问：http://localhost:3000
 */

const express = require('express');
const path = require('path');
const { fetchStockKline, fetchFundRealtime } = require('./data/fetcher');
const { analyze } = require('./strategy/indicators');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// 行业主题 ETF/LOF 基金池（覆盖大方向板块，均有交易所 K 线）
const FUND_POOL = [
  // 全球/宽基
  { code: '510300', name: '沪深300ETF', type: '宽基' },
  { code: '159915', name: '创业板ETF', type: '宽基' },
  { code: '588000', name: '科创50ETF', type: '宽基' },
  { code: '510050', name: '上证50ETF', type: '宽基' },

  // 美股/跨境
  { code: '513100', name: '纳斯达克ETF', type: '美股' },
  { code: '513500', name: '标普500ETF', type: '美股' },
  { code: '159509', name: '纳指科技ETF', type: '美股' },
  { code: '513050', name: '中概互联ETF', type: '跨境' },
  { code: '513130', name: '恒生科技ETF', type: '跨境' },

  // 科技成长
  { code: '515980', name: '人工智能ETF', type: 'AI' },
  { code: '515880', name: '通信ETF(CPO)', type: 'CPO/通信' },
  { code: '512480', name: '半导体ETF', type: '半导体' },
  { code: '562500', name: '机器人ETF', type: '机器人' },
  { code: '159869', name: '游戏ETF', type: '游戏/传媒' },

  // 周期资源
  { code: '518880', name: '黄金ETF', type: '黄金' },
  { code: '512400', name: '有色金属ETF', type: '有色' },
  { code: '516150', name: '稀土ETF', type: '有色' },
  { code: '515220', name: '煤炭ETF', type: '煤炭' },
  { code: '561360', name: '石油ETF', type: '油气' },

  // 金融地产
  { code: '512800', name: '银行ETF', type: '银行' },
  { code: '512000', name: '券商ETF', type: '券商' },
  { code: '512200', name: '房地产ETF', type: '地产' },

  // 消费医药
  { code: '512690', name: '酒ETF', type: '消费' },
  { code: '512170', name: '医疗ETF', type: '医药' },
  { code: '159992', name: '创新药ETF', type: '医药' },

  // 新能源/制造/电力
  { code: '515030', name: '新能源车ETF', type: '新能源' },
  { code: '515790', name: '光伏ETF', type: '新能源' },
  { code: '159611', name: '电力ETF', type: '电力' },

  // 军工/农业/红利/央企
  { code: '512660', name: '军工ETF', type: '军工' },
  { code: '159825', name: '农业ETF', type: '农业' },
  { code: '510880', name: '红利ETF', type: '红利' },
  { code: '561580', name: '央企红利ETF', type: '央企' }
];

// 场外基金池：仅做实时估值提示
const OFFSITE_FUND_POOL = [
  { code: '161725', name: '招商中证白酒指数' },
  { code: '005827', name: '易方达蓝筹精选' },
  { code: '001051', name: '华夏上证50ETF联接' },
  { code: '161005', name: '富国天惠成长混合' },
  { code: '003494', name: '富国天盛灵活配置' },
  { code: '110022', name: '易方达消费行业' },
  { code: '260108', name: '景顺长城新兴成长' }
];

let cache = {
  funds: null,
  all: null,
  offsiteFunds: null,
  updatedAt: null,
  expiresAt: null
};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 分钟缓存

async function asyncPool(items, fn, concurrency = 6) {
  const results = new Array(items.length);
  const queue = items.map((item, i) => ({ item, i }));
  async function worker() {
    while (queue.length) {
      const { item, i } = queue.shift();
      results[i] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function analyzePool(pool, kind) {
  const results = [];
  for (const item of pool) {
    try {
      const klines = await fetchStockKline(item.code, 120);
      if (!klines || klines.length < 70) {
        results.push({ ...item, kind, error: '数据不足' });
      } else {
        const res = analyze(item.code, item.name, klines);
        results.push({ ...res, kind, type: item.type });
      }
    } catch (err) {
      results.push({ ...item, kind, error: err.message });
    }

  }
  return results.sort((a, b) => (b.score || -999) - (a.score || -999));
}

async function analyzeOffsiteFunds() {
  const results = [];
  for (const item of OFFSITE_FUND_POOL) {
    try {
      const rt = await fetchFundRealtime(item.code);
      if (!rt) {
        results.push({ ...item, kind: '场外基金', error: '估值获取失败' });
        continue;
      }
      const pct = rt.pctChange;
      let action, position;
      if (pct <= -2) { action = '逢低布局'; position = '可考虑小额定投/加仓'; }
      else if (pct < -1) { action = '关注'; position = '可小仓位试探'; }
      else if (pct <= 1) { action = '观望'; position = '按原定投计划执行'; }
      else if (pct <= 2) { action = '谨慎追涨'; position = '不建议大幅加仓'; }
      else { action = '止盈观察'; position = '已持有者考虑分批减仓'; }
      results.push({
        ...item,
        kind: '场外基金',
        date: rt.date,
        price: rt.price,
        pctChange: pct,
        nav: rt.nav,
        action,
        position,
        score: pct < -1 ? 1 : pct > 2 ? -1 : 0,
        reason: `估算净值 ${rt.price}，估算涨跌幅 ${pct}%`
      });
    } catch (err) {
      results.push({ ...item, kind: '场外基金', error: err.message });
    }
  }
  return results.sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function refreshCache() {
  const [funds, offsiteFunds] = await Promise.all([
    analyzePool(FUND_POOL, '基金'),
    analyzeOffsiteFunds()
  ]);
  cache = {
    funds,
    offsiteFunds,
    all: [...funds, ...offsiteFunds].sort((a, b) => (b.score || -999) - (a.score || -999)),
    updatedAt: new Date().toISOString(),
    expiresAt: Date.now() + CACHE_TTL_MS
  };
  return cache;
}

async function getCache() {
  if (cache.expiresAt && Date.now() < cache.expiresAt) return cache;
  return refreshCache();
}

// 国内外财经新闻（新浪滚动新闻）
async function fetchNews() {
  const { request } = require('./data/fetcher');
  const formatTime = (item) => {
    if (item.create_time) return item.create_time;
    if (item.time) return item.time;
    const ts = item.ctime || item.intime;
    if (ts) {
      const d = new Date(Number(ts) * 1000);
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    }
    return '';
  };
  const fetchList = async (lid) => {
    const url = `https://feed.sina.com.cn/api/roll/get?pageid=153&lid=${lid}&k=&num=15&r=${Math.random()}`;
    try {
      const data = await request(url);
      const json = JSON.parse(data);
      const list = (json.result && json.result.data) || [];
      return list.map(i => ({
        title: i.title,
        url: i.url,
        time: formatTime(i),
        tag: lid === 2516 ? '国内' : '国际'
      }));
    } catch { return []; }
  };

  const [domestic, international] = await Promise.all([
    fetchList(2516), // 国内财经
    fetchList(2517)  // 国际财经
  ]);
  const all = [...domestic, ...international]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 20);
  return { domestic, international, all };
}

app.get('/api/funds', async (req, res) => {
  try {
    const data = await getCache();
    res.json({ updatedAt: data.updatedAt, data: data.funds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/offsite-funds', async (req, res) => {
  try {
    const data = await getCache();
    res.json({ updatedAt: data.updatedAt, data: data.offsiteFunds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/all', async (req, res) => {
  try {
    const data = await getCache();
    res.json({ updatedAt: data.updatedAt, data: data.all });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/news', async (req, res) => {
  try {
    const news = await fetchNews();
    res.json({ updatedAt: new Date().toISOString(), ...news });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/refresh', async (req, res) => {
  try {
    const data = await refreshCache();
    res.json({ updatedAt: data.updatedAt, message: '数据已刷新', count: data.all.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/detail/:code', async (req, res) => {
  try {
    const code = req.params.code;
    const item = FUND_POOL.find(i => i.code === code);
    if (!item) return res.status(404).json({ error: '标的未找到' });
    const klines = await fetchStockKline(code, 120);
    if (!klines || klines.length < 70) return res.status(500).json({ error: 'K线数据不足' });
    const analysis = analyze(item.code, item.name, klines);
    const recentKlines = klines.slice(-30);
    res.json({ ...analysis, kind: item.type, klines: recentKlines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`行业主题基金推荐服务已启动：http://localhost:${PORT}`);
  console.log(`首次访问时会自动拉取行情数据，请耐心等待...`);
});
