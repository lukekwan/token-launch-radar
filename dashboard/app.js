// Token Radar's dashboard (radar-4). It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail drawer with the model's own inputs
// and the protocol's farm plan, the category multiples the model priced from, and a sandbox that re-runs
// the model under different constants. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  var sandbox = { k: DATA.model.shrink_k, cap: DATA.model.multiple_cap, growth: DATA.model.growth_weight, momentum: DATA.model.momentum_weight };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // The model in one function, run in the page: the same arithmetic main.ts ran, from the same inputs,
  // so the page's code and the board's data are visibly the same model. The sandbox re-runs it with its
  // own shrinkage and cap; the board's own numbers use the model's constants.
  function multiplesFor(k, cap) {
    var m = DATA.model;
    var out = {};
    var cats = Object.keys(DATA.multiples);
    cats.forEach(function (c) {
      var e = DATA.multiples[c];
      if (e.median === null || e.median === undefined) { out[c] = DATA.overall_multiple; return; }
      out[c] = clamp((e.comps * e.median + k * DATA.overall_multiple) / (e.comps + k), m.multiple_floor, cap);
    });
    return out;
  }
  function impliedOf(row, k, cap, growthWeight, momentumWeight) {
    var m = DATA.model;
    var mults = multiplesFor(k, cap);
    var mult = mults[row.category || 'Other'];
    if (mult === undefined) mult = DATA.overall_multiple;
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, m.growth_floor, m.growth_cap);
    var growthMult = 1 + (growth / 100) * growthWeight;
    var catMedian = DATA.category_growth ? DATA.category_growth[row.category || 'Other'] : null;
    var rawMomentum = (catMedian === null || catMedian === undefined) ? 0 : (row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d) - catMedian;
    var momentum = clamp(rawMomentum, m.momentum_floor, m.momentum_cap);
    var momentumMult = 1 + (momentum / 100) * momentumWeight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var maturity = m.maturity_floor + (clamp(age, 0, m.maturity_days) / m.maturity_days) * m.maturity_range;
    return { implied: Math.max(1, Math.round(row.tvl_usd * mult * growthMult * momentumMult * maturity)), multiple: mult, growthMult: growthMult, momentumMult: momentumMult, maturity: maturity };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function gasFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c.indexOf('ethereum') >= 0) return 'about $12';
    if (c.indexOf('solana') >= 0 || c.indexOf('sui') >= 0 || c.indexOf('aptos') >= 0 || c.indexOf('near') >= 0 || c.indexOf('tron') >= 0 || c.indexOf('ton') >= 0) return 'under $0.10';
    if (
      c.indexOf('arbitrum') >= 0 || c.indexOf('optimism') >= 0 || c.indexOf('base') >= 0 || c.indexOf('blast') >= 0 || c.indexOf('mode') >= 0 ||
      c.indexOf('linea') >= 0 || c.indexOf('scroll') >= 0 || c.indexOf('zksync') >= 0 || c.indexOf('mantle') >= 0 || c.indexOf('polygon') >= 0 ||
      c.indexOf('bsc') >= 0 || c.indexOf('bnb') >= 0 || c.indexOf('avalanche') >= 0 || c.indexOf('gnosis') >= 0 || c.indexOf('celo') >= 0 ||
      c.indexOf('metis') >= 0 || c.indexOf('fantom') >= 0 || c.indexOf('berachain') >= 0 || c.indexOf('hyperliquid') >= 0 || c.indexOf('opbnb') >= 0
    ) return 'about $1';
    return 'about $3';
  }
  function secondActionFor(p, capital, chain) {
    var small = Math.max(10, Math.round(capital / 5));
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow $' + small + ' of USDC against the deposit once, then repay it, so the position shows both sides of the market.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + small + ' through the pool once so the wallet shows trading activity as well as liquidity.';
    if (c.indexOf('bridge') >= 0) return 'Bridge a second, smaller amount back the other way so the round trip is recorded.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the rewards once, or delegate a second small stake, so the position grows instead of sitting still.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Close the hedge and open a fresh one, so the position shows more than one trade.';
    if (c.indexOf('prediction') >= 0) return 'Place a second market position on the other side, with a smaller stake.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Move $' + small + ' between two of the vaults once, so the wallet shows an allocation choice.';
    if (c.indexOf('stable') >= 0) return 'Redeem a small amount of the stable asset and mint it again, so the position shows both directions.';
    if (c.indexOf('rwa') >= 0) return 'Claim any yield the position earned and reinvest it once.';
    if (c.indexOf('insurance') >= 0) return 'Open a second, smaller cover on a different pool so the wallet shows more than one policy.';
    return 'Do one more on-chain action in the app, such as a swap or a vote, so the wallet is not a one-transaction farmer.';
  }
  function positionNounFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'the supply position';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'the LP position';
    if (c.indexOf('bridge') >= 0) return 'the bridged funds';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'the stake';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'the margin';
    if (c.indexOf('prediction') >= 0) return 'the market position';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'the vault shares';
    if (c.indexOf('stable') >= 0) return 'the stable balance';
    if (c.indexOf('rwa') >= 0) return 'the yield asset';
    if (c.indexOf('insurance') >= 0) return 'the cover';
    return 'the position';
  }
  function weeklyActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'supply or borrow';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'swap through the pool';
    if (c.indexOf('bridge') >= 0) return 'bridge a small amount';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'claim and restake the rewards';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'open and close a small hedge';
    if (c.indexOf('prediction') >= 0) return 'place a market position';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'move a little between the vaults';
    if (c.indexOf('stable') >= 0) return 'mint or redeem a little of the stable asset';
    if (c.indexOf('rwa') >= 0) return 'claim the yield the position earned';
    if (c.indexOf('insurance') >= 0) return 'check the cover is still active';
    return 'do one more action in the app';
  }
  function rewardNounFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'the interest';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'the trading fees';
    if (c.indexOf('bridge') >= 0) return 'any points';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'the staking rewards';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'any funding or rebate';
    if (c.indexOf('prediction') >= 0) return 'any winnings';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'the yield';
    if (c.indexOf('stable') >= 0) return 'the yield';
    if (c.indexOf('rwa') >= 0) return 'the yield';
    if (c.indexOf('insurance') >= 0) return 'any rebate';
    return 'any points or rewards';
  }
  function ageStep(p, gas) {
    var age = p.age_days;
    if (age !== null && age !== undefined && age < 180) {
      return { text: p.name + ' is ' + age + ' days old, so it is early: join its Discord or Telegram and watch for the points announcement before the crowd arrives.', cost: 'nothing to join', time: '10 minutes' };
    }
    if (age !== null && age !== undefined && age >= 365) {
      return { text: p.name + ' has run ' + age + ' days with no token: check its governance forum once and vote on one proposal so the wallet is a participant, not only a depositor.', cost: gas + ' of gas to vote', time: '15 minutes' };
    }
    return { text: "Read " + p.name + "'s own docs once and confirm the action you did is the one its points program counts.", cost: 'nothing', time: '10 minutes' };
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var gas = gasFor(chain);
    var position = positionNounFor(p);
    var weekly = weeklyActionFor(p);
    var reward = rewardNounFor(p);
    return [
      { text: 'Use a fresh wallet on ' + chain + ' that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' of gas for the first transaction on ' + chain, time: '5 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and ' + gas + ' of gas', time: '15 minutes to set up' },
      { text: secondActionFor(p, capital, chain), cost: gas + ' of gas', time: '10 minutes' },
      { text: 'Once a week, ' + weekly + ' on ' + p.name + ' so the wallet shows steady activity.', cost: gas + ' of gas a week', time: '10 minutes a week' },
      { text: 'Keep ' + position + ' open for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in ' + position, time: hold + ' days' },
      ageStep(p, gas),
      { text: 'Claim what ' + position + ' earned — ' + reward + ' — from the protocol\'s own page only, never from a link in a DM.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, and cap ' + position + ' at $' + capital + ' so a hack costs at most that.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise.' }),
        el('p', { text: 'Each protocol is priced at the multiple its own category trades at: the median market-cap-to-TVL ratio of the live-token protocols in that category, shrunk toward the overall median so one or two comps cannot set the price.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var multRows = Object.keys(DATA.multiples).sort().map(function (c) {
      var e = DATA.multiples[c];
      var flag = '';
      if (e.comps <= 2) flag = 'thin: ' + e.comps + ' comp' + (e.comps === 1 ? '' : 's');
      if (e.multiple >= m.multiple_cap) flag = flag ? flag + ' · capped' : 'capped at ' + m.multiple_cap + 'x';
      return el('tr', null,
        el('td', { text: c }),
        el('td', { class: 'num', text: e.multiple.toFixed(3) + 'x' }),
        el('td', { class: 'num', text: String(e.comps) }),
        el('td', { class: 'num', text: e.median === null || e.median === undefined ? 'n/a' : e.median.toFixed(3) + 'x' }),
        el('td', { class: 'thin', text: flag })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ',
        el('b', { text: 'multiple(category)' }),
        ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (1 + clamp(change_7d - median(change_7d in category), ' + m.momentum_floor + ', ' + m.momentum_cap + ') / 100 x ' + m.momentum_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )'
      ),
      el('p', { class: 'sub', text: 'The multiple is the median market-cap-to-TVL ratio of the live-token protocols in the same category, shrunk toward the overall median (' + DATA.overall_multiple.toFixed(3) + 'x, from ' + Object.keys(DATA.multiples).reduce(function (a, c) { return a + DATA.multiples[c].comps; }, 0) + ' live-token comps with a positive market cap): multiple = (n x median + ' + m.shrink_k + ' x overall) / (n + ' + m.shrink_k + '), clamped to [' + m.multiple_floor + ', ' + m.multiple_cap + ']. A category with no live-token comps takes the overall median. Momentum is the protocol\'s seven-day move against its own category\'s median move: growing while the category is flat is worth more than growing with the crowd, and shrinking while the category grows is worth less. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days.' }),
      el('div', { class: 'table-wrap' },
        el('table', { class: 'multiples' },
          el('caption', { class: 'sub', text: 'Category multiples: what the market pays for a token in each category, and how many live-token comps priced it.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', text: 'Multiple' }),
            el('th', { scope: 'col', text: 'Comps' }),
            el('th', { scope: 'col', text: 'Median' }),
            el('th', { scope: 'col', text: 'Note' })
          )),
          el('tbody', null, multRows)
        )
      ),
      el('p', { class: 'note', text: 'Thin categories are shrunk hardest toward the overall median: their multiple is mostly the market as a whole, not one or two comps. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.' })
    );
  }

  function sandboxPanel() {
    var out = el('ol', { class: 'top10' });
    var kInput = el('input', { type: 'number', id: 'sb-k', min: '0', max: '20', step: '1', value: String(sandbox.k) });
    var capInput = el('input', { type: 'number', id: 'sb-cap', min: '0.05', max: '2', step: '0.05', value: String(sandbox.cap) });
    var growthInput = el('input', { type: 'number', id: 'sb-growth', min: '0', max: '1', step: '0.1', value: String(sandbox.growth) });
    var momentumInput = el('input', { type: 'number', id: 'sb-momentum', min: '0', max: '1', step: '0.1', value: String(sandbox.momentum) });
    function rerun() {
      var k = parseFloat(kInput.value);
      var cap = parseFloat(capInput.value);
      var gw = parseFloat(growthInput.value);
      var mw = parseFloat(momentumInput.value);
      if (!isFinite(k) || k < 0) k = sandbox.k;
      if (!isFinite(cap) || cap <= 0) cap = sandbox.cap;
      if (!isFinite(gw) || gw < 0) gw = sandbox.growth;
      if (!isFinite(mw) || mw < 0) mw = sandbox.momentum;
      sandbox = { k: k, cap: cap, growth: gw, momentum: mw };
      var rescored = DATA.rows.map(function (r) {
        var v = impliedOf(r, k, cap, gw, mw);
        return { row: r, implied: v.implied };
      });
      rescored.sort(function (a, b) { return b.implied - a.implied || (a.row.slug < b.row.slug ? -1 : 1); });
      out.textContent = '';
      rescored.slice(0, 10).forEach(function (s, i) {
        var move = s.row.rank - (i + 1);
        var arrow = move > 0 ? '▲' + move : move < 0 ? '▼' + (-move) : '–';
        out.appendChild(el('li', null,
          el('b', { text: s.row.name + ' ' }),
          el('span', { class: 'num', text: fmtUsd(s.implied) + ' ' }),
          el('span', { class: 'sub', text: '(board #' + s.row.rank + ', ' + arrow + ')' })
        ));
      });
    }
    [kInput, capInput, growthInput, momentumInput].forEach(function (inp) { inp.addEventListener('input', rerun); });
    rerun();
    return el('section', { class: 'panel sandbox' },
      el('h2', { text: 'Model sandbox' }),
      el('p', { class: 'sub', text: 'The model is a function, not a list: change its constants and the top ten re-ranks in front of you. The board above always shows the model as handed in (shrinkage ' + DATA.model.shrink_k + ', cap ' + DATA.model.multiple_cap + 'x, growth weight ' + DATA.model.growth_weight + ', momentum weight ' + DATA.model.momentum_weight + ').' }),
      el('div', { class: 'grid' },
        el('div', null, el('label', { for: 'sb-k', text: 'Shrinkage k (higher pulls thin categories to the overall median)' }), kInput),
        el('div', null, el('label', { for: 'sb-cap', text: 'Multiple cap (no category is valued above this)' }), capInput),
        el('div', null, el('label', { for: 'sb-growth', text: 'Growth weight (how much seven-day momentum matters)' }), growthInput),
        el('div', null, el('label', { for: 'sb-momentum', text: 'Momentum weight (how much beating the category matters)' }), momentumInput)
      ),
      el('div', null, el('b', { text: 'Top ten under these constants' }), out),
      el('button', { class: 'button reset', type: 'button', text: 'Reset to the handed-in model', onclick: function () {
        kInput.value = String(DATA.model.shrink_k);
        capInput.value = String(DATA.model.multiple_cap);
        growthInput.value = String(DATA.model.growth_weight);
        momentumInput.value = String(DATA.model.momentum_weight);
        rerun();
      } })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var check = impliedOf(row, DATA.model.shrink_k, DATA.model.multiple_cap, DATA.model.growth_weight, DATA.model.momentum_weight);
    var comps = DATA.multiples[row.category || 'Other'];
    var catMedian = DATA.category_growth ? DATA.category_growth[row.category || 'Other'] : null;
    var relMomentum = (catMedian === null || catMedian === undefined || row.change_7d === null || row.change_7d === undefined) ? null : row.change_7d - catMedian;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? (row.chains.length > 4 ? row.chains.slice(0, 4).join(', ') + ', and ' + (row.chains.length - 4) + ' more' : row.chains.join(', ')) : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category multiple' }), el('b', { class: 'num', text: row.multiple.toFixed(3) + 'x' + (comps ? ' (' + comps.comps + ' comp' + (comps.comps === 1 ? '' : 's') + ')' : '') })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Category median 7d' }), el('b', { class: 'num', text: catMedian === null || catMedian === undefined ? 'n/a' : fmtPct(catMedian) })),
        el('div', null, el('span', { text: 'Growth vs category' }), el('b', { class: 'num', text: relMomentum === null ? 'n/a' : fmtPct(relMomentum) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: row.growth_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Momentum multiplier' }), el('b', { class: 'num', text: row.momentum_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: row.maturity_multiplier.toFixed(3) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(check.implied) + (check.implied === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    if (state.tab === 'pre-token') shell.appendChild(sandboxPanel());
    shell.appendChild(el('footer', { class: 'foot' },
      el('p', { text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. Model ' + DATA.model_version + ': implied value is an estimate from the snapshot, not a price, and not investment advice. The live-token view shows market caps as recorded.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
