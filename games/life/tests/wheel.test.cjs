'use strict';

// Run: node --test games/life/tests/wheel.test.cjs
// Optional exact behavior comparison against the pre-fix HTML:
// node games/life/tests/wheel.test.cjs --baseline /path/to/original-index.html
// LIFE_HTML can point to another version to reproduce the original failure.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const htmlPath = process.env.LIFE_HTML || path.join(__dirname, '..', 'index.html');
const baselineFlag = process.argv.indexOf('--baseline');
const baselinePath = baselineFlag >= 0 ? process.argv[baselineFlag + 1] : null;
const compiled = new Map();

function source(file) {
  if (!compiled.has(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const init = script.lastIndexOf('\n(function init(){');
    assert.ok(init >= 0, 'the game startup entry point must be present');
    // Skip only startup screen rendering. All game functions and event data are real.
    compiled.set(file, {
      script: new vm.Script(script.slice(0, init), { filename: file }),
      ids: [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
    });
  }
  return compiled.get(file);
}

function element() {
  const classes = new Set();
  const node = {
    style: {}, children: [], textContent: '', value: '', disabled: false,
    className: '', scrollLeft: 0, scrollWidth: 0,
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, force) {
        const on = force === undefined ? !classes.has(name) : force;
        on ? classes.add(name) : classes.delete(name);
        return on;
      }
    },
    appendChild(child) { this.children.push(child); return child; },
    querySelectorAll() { return this.children; },
    scrollIntoView() {},
    setAttribute() {},
    getBoundingClientRect() { return { width: 300, height: 300 }; }
  };
  let markup = '';
  Object.defineProperty(node, 'innerHTML', {
    get: () => markup,
    set(value) { markup = value; node.children = []; }
  });
  return node;
}

function game(file = htmlPath) {
  const { script, ids } = source(file);
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const storage = new Map();
  const warnings = [];
  const errors = [];
  let clock = 0, nextTimer = 1, randomCalls = 0, randomState = 1;
  let forcedRandom = [];
  const timers = new Map();
  const math = Object.create(Math);
  math.random = () => {
    randomCalls++;
    if (forcedRandom.length) return forcedRandom.shift();
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const context = vm.createContext({
    ...nodes, Math: math,
    console: { log() {}, warn: (...args) => warnings.push(args), error: (...args) => errors.push(args) },
    document: {
      getElementById: id => nodes[id] || (nodes[id] = element()),
      createElement: () => element(),
      querySelectorAll: selector => selector === '.choice' ? nodes.choices.children : []
    },
    window: { scrollTo() {} }, location: { reload() {} }, confirm: () => false,
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    setTimeout(fn, delay = 0) {
      const id = nextTimer++;
      timers.set(id, { fn, due: clock + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  });
  script.runInContext(context);
  const run = expression => vm.runInContext(expression, context);
  const json = expression => JSON.parse(run(`JSON.stringify(${expression})`));
  const api = {
    run, json, nodes, storage, warnings, errors,
    seed(seed, values = []) { randomState = seed >>> 0; forcedRandom = [...values]; randomCalls = 0; },
    randomCalls: () => randomCalls,
    pending: () => timers.size,
    fireWatchdog() {
      const entry = [...timers].find(([, timer]) => timer.due - clock === 12000);
      assert.ok(entry, 'ordinary draw must have a watchdog');
      timers.delete(entry[0]);
      entry[1].fn();
    },
    flush() {
      let executed = 0;
      while (timers.size) {
        assert.ok(executed++ < 10000, 'timer queue must terminate');
        const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        timers.delete(id);
        clock = timer.due;
        timer.fn();
      }
    },
    draw(mode) { run('resetWheelUI()'); run(mode === 'fast' ? 'fastDrawEvent()' : 'spinWheel()'); api.flush(); },
    world(settings) {
      context.worldSettings = settings;
      run('Object.assign(state,worldSettings); syncEraCategories();');
    },
    synthetic(count) {
      run(`categories=Array.from({length:${count}},(_,i)=>'test-'+i); renderWheelLabels();`);
    },
    snapshot() {
      return {
        event: json('currentEvent'), state: json('state'), meta: json('metaState'),
        pointerIndex: run('pointerIndex'), randomCalls,
        storage: [...storage].sort((a, b) => a[0].localeCompare(b[0]))
      };
    }
  };
  run(`
    metaState=defaultMeta();
    // Geometry tests exercise an existing player's tools; fresh-player locks
    // are covered separately by story.test.cjs.
    if(typeof normalizeStoryProgress==='function'){
      delete metaState.storyProgress;
      normalizeStoryProgress(metaState,true);
    }
    state={
      name:'轮盘测试',avatar:'🧪',age:28,majorDone:0,targetMajor:99,legend:0,
      era:'modern',realmIndex:0,cultivationExp:0,worldsUnlocked:false,
      lifePotentialRoll:0,childhoodVariantSeed:1,abilities:[],body:20,mind:20,charm:20,family:20,
      history:[],yearlyLog:[{age:0,text:'测试出生',type:'birth',stats:{body:5,mind:5,charm:5,family:5}}],
      ended:false,dead:false,lifeCounted:false,lifeCompleted:false,rewardOptions:null,rewardClaimed:null,
      currentDaily:'测试',initialStats:{body:5,mind:5,charm:5,family:5}
    };
    normalizeLife(); saveLife(); saveMeta();
  `);
  api.seed(1);
  return api;
}

function assertAligned(g, message = '') {
  const names = g.json('categories');
  const transform = g.nodes.wheel.style.transform;
  assert.match(transform || '', /^rotate\(-?[\d.e+]+deg\)$/, message);
  const degrees = Number(transform.match(/rotate\((.*)deg\)/)[1]);
  // CSS conic gradients start at twelve o'clock and increase clockwise.
  // The stationary pointer is at twelve o'clock, so invert the wheel rotation.
  const localAngle = ((-degrees % 360) + 360) % 360;
  const sectorSize = 360 / names.length;
  const visualIndex = Math.floor(localAngle / sectorSize);
  assert.equal(visualIndex, g.run('pointerIndex'), `${message}: visual sector vs pointerIndex`);
  const center = (visualIndex + 0.5) * sectorSize;
  assert.ok(Math.abs(localAngle - center) < 1e-6, `${message}: pointer must stop inside the sector, at its center`);
  return names[visualIndex];
}

function assertDraw(g, expected, message = '') {
  assert.equal(g.run('spinning'), false, `${message}: draw must finish`);
  assert.equal(assertAligned(g, message), expected);
  assert.equal(g.run('currentEvent.category'), expected);
  assert.equal(g.nodes.eventTag.textContent, expected + '重大抉择');
  assert.equal(g.errors.length, 0, `${message}: no swallowed runtime exceptions`);
}

test('regression: modern fast draw selects 学业 and visibly stops on 学业', () => {
  const g = game();
  // Original code chooses category 0 but rotates by eight of fourteen sectors.
  g.seed(1, [0, 0.5, 0.5]);
  g.draw('fast');
  assertDraw(g, '学业');
});

test('fast draw: every target matches the pointer, independently of the old animation random value', () => {
  const g = game();
  for (const count of [1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 14, 17]) {
    g.synthetic(count);
    for (const start of [0, count - 1]) {
      for (let target = 0; target < count; target++) {
        for (const animationRandom of [0, 0.37, 0.999999]) {
          g.run(`pointerIndex=${start}; renderWheelLabels();`);
          g.seed(42, [(target + 0.5) / count, animationRandom, 0.5]);
          g.draw('fast');
          assertDraw(g, 'test-' + target, `count=${count}, start=${start}, target=${target}`);
          assert.equal(g.randomCalls(), 3, 'category, animation budget and event choice consume exactly three random samples');
        }
      }
    }
  }
});

test('ordinary draw preserves the original step distribution and settles at the matching center', () => {
  const g = game();
  for (const count of [1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 14, 17]) {
    g.synthetic(count);
    for (const start of [0, count - 1]) {
      for (const fullTurns of [3, 4]) {
        // The existing rand(3,count+1) has count-1 outcomes (one for count<=2).
        for (let offset = 3; offset <= Math.max(3, count + 1); offset++) {
          g.run(`pointerIndex=${start}; renderWheelLabels();`);
          g.seed(42, [fullTurns === 3 ? 0.25 : 0.75, count <= 2 ? 0.5 : (offset - 3 + 0.5) / (count - 1), 0.5]);
          g.draw('normal');
          const target = (start + count * fullTurns + offset) % count;
          assertDraw(g, 'test-' + target, `count=${count}, start=${start}, turns=${fullTurns}, offset=${offset}`);
          assert.equal(g.randomCalls(), 3);
        }
      }
    }
  }
});

test('mixed consecutive draws and all actual world category layouts stay synchronized', () => {
  const g = game();
  const layouts = g.json(`[
    {era:'modern'}, {era:'awakening'}, {era:'dao_choice'},
    ...realmConfigs.slice(1).flatMap((_,i)=>cultivationPaths.flatMap(path=>[false,true].map(worldsUnlocked=>
      ({era:'cultivation',realmIndex:i+1,cultivationPath:path.id,worldsUnlocked}))))
  ]`);
  const seen = new Set();
  for (const layout of layouts) {
    // Keep dao_choice selectable for this geometry-only test.
    g.world({ ...layout, pendingDaoChoice: false });
    const names = g.json('categories');
    assertAligned(g, JSON.stringify(layout));
    const key = names.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    for (let i = 0; i < 8; i++) {
      g.seed(1000 + i);
      g.draw(i % 2 ? 'normal' : 'fast');
      assertDraw(g, g.run('categories[pointerIndex]'), key);
    }
  }
  assert.ok(seen.size >= 10, 'exercise distinct category contents, not only one count');
  for (const era of ['modern', 'awakening', 'cultivation', 'modern']) {
    g.world({ era, realmIndex: 1, cultivationPath: 'body', worldsUnlocked: false });
    assertAligned(g, 'shrinking and growing world layout');
    g.draw('fast');
    assertDraw(g, g.run('categories[pointerIndex]'));
  }
});

test('rapid repeated activation and locked stages cannot enqueue extra draws or consume probability', () => {
  const g = game();
  for (const mode of ['fastDrawEvent()', 'spinWheel()']) {
    g.run('resetWheelUI()');
    g.seed(15);
    g.run(mode);
    const calls = g.randomCalls();
    const pending = g.pending();
    g.run('fastDrawEvent(); spinWheel();');
    assert.equal(g.randomCalls(), calls);
    assert.equal(g.pending(), pending);
    g.flush();
    assertDraw(g, g.run('categories[pointerIndex]'));
  }
  for (const locked of ['state.ended=true', 'state.dead=true', 'state.pendingDaoChoice=true', 'state.majorDone=state.targetMajor']) {
    const h = game();
    h.run(locked);
    const before = h.snapshot();
    h.run('fastDrawEvent(); spinWheel();');
    assert.equal(h.pending(), 0);
    assert.deepEqual(h.snapshot(), before);
  }
});

test('draw, choice, reroll and reload preserve progress and existing storage keys', () => {
  const g = game();
  g.run('metaState.lives=7; metaState.bonus.mind=3; saveMeta();');
  const lifeBefore = g.storage.get('random_life_legacy_save_v1');
  g.draw('fast');
  assert.equal(g.run('state.majorDone'), 0);
  assert.equal(g.run('metaState.lives'), 7);
  assert.equal(g.storage.get('random_life_legacy_save_v1'), lifeBefore, 'drawing itself does not advance or overwrite a life');
  assert.equal(g.run('state.recentEventIds.length'), 1);
  assert.equal(g.run('metaState.globalRecentEventIds.length'), 1);
  g.run('rerollEvent()');
  g.flush();
  assertDraw(g, g.run('categories[pointerIndex]'));
  assert.equal(g.run('rerollCountThisStage'), 1);
  assert.equal(g.run('state.majorDone'), 0);
  const choice = g.run('currentEvent.choices.findIndex(c=>!choiceLockReason(c))');
  assert.ok(choice >= 0);
  g.run(`chooseEvent(${choice})`);
  assert.equal(g.run('state.majorDone'), 1);
  assert.equal(g.run('state.history.length'), 1);
  assert.equal(g.run('metaState.lives'), 7);
  const savedLife = JSON.parse(g.storage.get('random_life_legacy_save_v1'));
  const savedMeta = JSON.parse(g.storage.get('random_life_legacy_meta_v1'));
  assert.deepEqual(savedLife, g.json('state'));
  const h = game();
  for (const [key, value] of g.storage) h.storage.set(key, value);
  h.run('metaState=loadMeta(); state=loadLife(); normalizeLife(); saveLife();');
  assert.deepEqual(h.json('state'), savedLife);
  assert.deepEqual(h.json('metaState'), savedMeta);
  assertAligned(h, 'reloaded life');
  assert.deepEqual([...h.storage.keys()].sort(), ['random_life_legacy_meta_v1', 'random_life_legacy_save_v1']);
  assert.equal(g.errors.length + h.errors.length, 0);
});

test('watchdog and fallback settlement leave exactly one result aligned with the stopped wheel', () => {
  const g = game();
  g.run('spinWheel()');
  const stoppedIndex = g.run('pointerIndex');
  g.fireWatchdog();
  g.flush();
  assert.equal(g.run('pointerIndex'), stoppedIndex, 'queued animation callbacks must stop after settlement');
  assert.equal(g.run('state.recentEventIds.length'), 1, 'watchdog settlement must not pick twice');
  assertDraw(g, g.run('categories[pointerIndex]'));
  for (const mode of ['fast', 'normal']) {
    const h = game();
    h.run('pickEvent=()=>{throw new Error("intentional pool failure")};');
    h.draw(mode);
    const category = h.run('categories[pointerIndex]');
    assert.equal(assertAligned(h), category);
    assert.equal(h.run('currentEvent.category'), category);
    assert.equal(h.run('currentEvent.id'), 'fallback_' + category);
    assert.equal(h.run('spinning'), false);
    assert.equal(h.errors.length, 1, 'the expected event-pool failure is logged once');
  }
});

test('life settlement and reward claim remain idempotent after a draw', () => {
  const g = game();
  g.run('metaState.lives=7;');
  g.draw('fast');
  g.run("state.dead=true; state.deathAge=state.age; state.deathCause='测试结算'; finishLife();");
  assert.equal(g.run('metaState.lives'), 8);
  assert.equal(g.run('state.lifeCounted'), true);
  const settled = g.snapshot();
  g.run('finishLife()');
  assert.deepEqual(g.snapshot(), settled, 'reopening an ending does not award another completed life');
  assert.ok(g.run('state.rewardOptions.length') > 0);
  g.run('claimReward(state.rewardOptions[0])');
  const rewarded = g.snapshot();
  g.run('claimReward(state.rewardOptions[0])');
  assert.deepEqual(g.snapshot(), rewarded, 'a legacy reward cannot be claimed twice');
  assert.equal(JSON.parse(g.storage.get('random_life_legacy_meta_v1')).lives, 8);
  assert.equal(g.errors.length, 0);
});

function gameplaySnapshot(g){
  const snapshot=g.snapshot();
  const strip=value=>{
    const copy=JSON.parse(JSON.stringify(value));
    // v2.1.0 intentionally adds prose and unlock bookkeeping. Compare the
    // gameplay and persisted gameplay fields independently of these additions.
    for(const key of ['narrative','storyProgress','storyProgressSeenChoices','storyProgressVersion','yearlyLog'])delete copy[key];
    return copy;
  };
  snapshot.state=strip(snapshot.state);
  snapshot.meta=strip(snapshot.meta);
  snapshot.storage=snapshot.storage.map(([key,value])=>[key,strip(JSON.parse(value))]);
  return snapshot;
}

test('optional pre-fix comparison: identical RNG stream preserves events and saved gameplay state', { skip: !baselinePath }, () => {
  for (const seed of [1, 7, 42, 20261022]) {
    const fixed = game();
    const original = game(baselinePath);
    for (const g of [fixed, original]) g.seed(seed);
    for (let i = 0; i < 18; i++) {
      const settings = i < 6 ? { era: 'modern' } : i < 12 ? { era: 'awakening' } :
        { era: 'cultivation', realmIndex: 1, cultivationPath: 'body', worldsUnlocked: false };
      for (const g of [fixed, original]) {
        g.world({ ...settings, pendingDaoChoice: false, dead: false });
        g.draw(i % 2 ? 'normal' : 'fast');
        const choice = g.run('currentEvent.choices.findIndex(c=>!choiceLockReason(c))');
        assert.ok(choice >= 0);
        g.run(`chooseEvent(${choice})`);
        g.run('saveMeta(); saveLife();');
      }
      assert.deepEqual(gameplaySnapshot(fixed), gameplaySnapshot(original), `seed=${seed}, mixed draw=${i}`);
      assert.equal(fixed.errors.length + original.errors.length, 0);
    }
    for (const g of [fixed, original]) {
      g.run("state.dead=true; state.deathAge=state.age; state.deathCause='测试结算'; finishLife(); finishLife(); claimReward(state.rewardOptions[0]);");
    }
    assert.deepEqual(gameplaySnapshot(fixed), gameplaySnapshot(original), `seed=${seed}, ending and legacy reward`);
  }
});
