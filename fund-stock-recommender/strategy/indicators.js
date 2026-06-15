/**
 * 技术指标与推荐策略模块
 */

function sma(values, n) {
  const res = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    res.push(i >= n - 1 ? sum / n : null);
  }
  return res;
}

function ema(values, n) {
  const res = [];
  const alpha = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    if (prev === null) prev = values[i];
    else prev = alpha * values[i] + (1 - alpha) * prev;
    res.push(prev);
  }
  return res;
}

function macd(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const dif = ema12.map((v, i) => v - ema26[i]);
  const dea = ema(dif, 9);
  const macdHist = dif.map((v, i) => 2 * (v - dea[i]));
  return { dif, dea, macdHist };
}

function rsi(closes, n = 14) {
  const res = [];
  let gain = 0, loss = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) { res.push(null); continue; }
    const change = closes[i] - closes[i - 1];
    const g = Math.max(change, 0);
    const l = Math.max(-change, 0);
    if (i < n) {
      gain += g; loss += l;
      res.push(null);
    } else if (i === n) {
      gain += g; loss += l;
      const avgGain = gain / n;
      const avgLoss = loss / n;
      res.push(avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss)));
    } else {
      const prevGain = ((res[i - 1] ? (res[i - 1] === 100 ? 0 : 1) : 0)); // placeholder, use smoothed
      // smoothed RSI
      const avgGainPrev = (res[i - 1] === null) ? 0 : 0; // not needed, recalc below with running sums
      gain = (gain * (n - 1) + g) / n;
      loss = (loss * (n - 1) + l) / n;
      res.push(loss === 0 ? 100 : 100 - (100 / (1 + gain / loss)));
    }
  }
  return res;
}

function kdj(klines) {
  const n = 9, m1 = 3, m2 = 3;
  const lows = klines.map(k => k.low);
  const highs = klines.map(k => k.high);
  const closes = klines.map(k => k.close);
  const K = [], D = [], J = [];
  let prevK = 50, prevD = 50;
  for (let i = 0; i < klines.length; i++) {
    const start = Math.max(0, i - n + 1);
    const llv = Math.min(...lows.slice(start, i + 1));
    const hhv = Math.max(...highs.slice(start, i + 1));
    const rsv = hhv === llv ? 50 : (closes[i] - llv) / (hhv - llv) * 100;
    const k = (2 / 3) * prevK + (1 / 3) * rsv;
    const d = (2 / 3) * prevD + (1 / 3) * k;
    const j = 3 * k - 2 * d;
    K.push(k); D.push(d); J.push(j);
    prevK = k; prevD = d;
  }
  return { K, D, J };
}

function boll(closes, n = 20, k = 2) {
  const ma = sma(closes, n);
  const upper = [], lower = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < n - 1) { upper.push(null); lower.push(null); continue; }
    const slice = closes.slice(i - n + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / n;
    const std = Math.sqrt(slice.reduce((sq, v) => sq + Math.pow(v - mean, 2), 0) / n);
    upper.push(mean + k * std);
    lower.push(mean - k * std);
  }
  return { ma, upper, lower };
}

function crossOver(a, b, i) {
  return a[i] > b[i] && a[i - 1] <= b[i - 1];
}
function crossUnder(a, b, i) {
  return a[i] < b[i] && a[i - 1] >= b[i - 1];
}

function analyze(code, name, klines) {
  if (!klines || klines.length < 70) {
    return { code, name, error: '数据不足，无法分析（至少需要70个交易日）' };
  }
  const closes = klines.map(k => k.close);
  const last = klines.length - 1;
  const prev = last - 1;

  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);

  const { dif, dea, macdHist } = macd(closes);
  const rsi14 = rsi(closes, 14);
  const { K, D, J } = kdj(klines);
  const { upper, lower } = boll(closes, 20);

  const price = closes[last];
  const scoreDetails = [];
  let score = 0;

  // 均线排列
  if (ma5[last] > ma10[last] && ma10[last] > ma20[last]) {
    score += 1;
    scoreDetails.push('均线多头排列');
  } else if (ma5[last] < ma10[last] && ma10[last] < ma20[last]) {
    score -= 1;
    scoreDetails.push('均线空头排列');
  }

  // 价格与 MA20 关系
  if (price > ma20[last]) {
    score += 1;
    scoreDetails.push('收盘价站上MA20');
  } else {
    score -= 1;
    scoreDetails.push('收盘价跌破MA20');
  }

  // MACD
  if (crossOver(dif, dea, last)) {
    score += 2;
    scoreDetails.push('MACD金叉');
  } else if (crossUnder(dif, dea, last)) {
    score -= 2;
    scoreDetails.push('MACD死叉');
  } else if (dif[last] > dea[last]) {
    score += 1;
    scoreDetails.push('MACD多头区间');
  } else {
    score -= 1;
    scoreDetails.push('MACD空头区间');
  }

  // RSI
  const r = rsi14[last];
  if (r < 30) {
    score += 2;
    scoreDetails.push('RSI超卖（反弹预期）');
  } else if (r < 50) {
    score += 1;
    scoreDetails.push('RSI偏低');
  } else if (r > 70) {
    score -= 2;
    scoreDetails.push('RSI超买');
  } else if (r > 55) {
    score -= 1;
    scoreDetails.push('RSI偏高');
  }

  // KDJ
  if (crossOver(K, D, last)) {
    score += 1;
    scoreDetails.push('KDJ金叉');
  } else if (crossUnder(K, D, last)) {
    score -= 1;
    scoreDetails.push('KDJ死叉');
  }

  // 布林带
  if (price <= lower[last] * 1.02) {
    score += 1;
    scoreDetails.push('触及布林带下轨');
  } else if (price >= upper[last] * 0.98) {
    score -= 1;
    scoreDetails.push('触及布林带上轨');
  }

  // 趋势强度（MA60）
  const trend = price > ma60[last] ? '上行' : '下行';
  if (price > ma60[last]) {
    score += 1;
    scoreDetails.push('价格站上MA60（中期上行）');
  } else {
    scoreDetails.push('价格跌破MA60（中期下行）');
  }

  // 生成建议
  let action, position, reason;
  if (score >= 5) {
    action = '强烈买入';
    position = '重仓（建议仓位 70%-90%）';
  } else if (score >= 3) {
    action = '买入';
    position = '半仓以上（建议仓位 50%-70%）';
  } else if (score > 0) {
    action = '轻仓买入';
    position = '轻仓试探（建议仓位 20%-30%）';
  } else if (score === 0) {
    action = '观望';
    position = '保持空仓或持仓不动';
  } else if (score >= -3) {
    action = '减仓';
    position = '降低仓位（建议仓位 30%以下）';
  } else {
    action = '卖出';
    position = '清仓或极小仓位';
  }

  reason = scoreDetails.length ? scoreDetails.join('；') : '信号不明显';

  return {
    code,
    name,
    date: klines[last].date,
    price: Number(price.toFixed(2)),
    pctChange: Number(klines[last].pctChange.toFixed(2)),
    score,
    action,
    position,
    reason,
    trend,
    indicators: {
      ma5: Number(ma5[last].toFixed(2)),
      ma10: Number(ma10[last].toFixed(2)),
      ma20: Number(ma20[last].toFixed(2)),
      ma60: Number(ma60[last].toFixed(2)),
      macd: Number(macdHist[last].toFixed(4)),
      dif: Number(dif[last].toFixed(4)),
      dea: Number(dea[last].toFixed(4)),
      rsi: Number(rsi14[last].toFixed(2)),
      k: Number(K[last].toFixed(2)),
      d: Number(D[last].toFixed(2)),
      j: Number(J[last].toFixed(2)),
      bollUpper: Number(upper[last].toFixed(2)),
      bollLower: Number(lower[last].toFixed(2))
    }
  };
}

module.exports = { analyze, sma, ema, macd, rsi, kdj, boll };
