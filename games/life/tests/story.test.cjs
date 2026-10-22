'use strict';

// Run: node --test games/life/tests/story.test.cjs
// Uses only Node built-ins. localStorage and timers are isolated in memory.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const htmlPath = process.env.LIFE_HTML || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const init = script.lastIndexOf('\n(function init(){');
assert.ok(init >= 0);
const compiled = new vm.Script(script.slice(0, init), { filename: htmlPath });
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);

function element() {
  const classes = new Set();
  const node = {
    style: {}, children: [], textContent: '', value: '', disabled: false, hidden: false,
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
    scrollIntoView() {}, setAttribute() {}, removeAttribute() {},
    getBoundingClientRect() { return { width: 300, height: 300 }; }
  };
  let markup = '';
  Object.defineProperty(node, 'innerHTML', {
    get: () => markup,
    set(value) { markup = value; node.children = []; }
  });
  return node;
}

function game({ start = true, storageEntries = [] } = {}) {
  const nodes = Object.fromEntries(ids.map(id => [id, element()]));
  const storage = new Map(storageEntries);
  const errors = [];
  let clock = 0, timerId = 0, randomCalls = 0, randomState = 7;
  let forced = [];
  const timers = new Map();
  const math = Object.create(Math);
  math.random = () => {
    randomCalls++;
    if (forced.length) return forced.shift();
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  const context = vm.createContext({
    ...nodes, Math: math,
    console: { log() {}, warn() {}, error: (...args) => errors.push(args) },
    document: {
      body: element(),
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
      const id = ++timerId;
      timers.set(id, { fn, due: clock + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  });
  compiled.runInContext(context);
  const run = expression => vm.runInContext(expression, context);
  const json = expression => JSON.parse(run(`JSON.stringify(${expression})`));
  const api = {
    run, json, nodes, storage, errors,
    runInit: () => run(script.slice(init)),
    seed(seed, values = []) { randomState = seed >>> 0; forced = [...values]; randomCalls = 0; },
    calls: () => randomCalls,
    pending: () => timers.size,
    flush() {
      let executed = 0;
      while (timers.size) {
        assert.ok(executed++ < 10000, 'timer queue must terminate');
        const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0];
        timers.delete(id); clock = timer.due; timer.fn();
      }
    },
    snapshot: () => ({ state: json('state'), meta: json('metaState'), storage: [...storage], randomCalls }),
    choice(success = true, category = '学业') {
      context.testCategory = category;
      run(`
        currentEvent=fallbackEvent(testCategory);
        currentEvent.category=testCategory;
        currentEvent.id='test_choice_'+state.history.length;
        currentEvent.title='测试选择 '+state.history.length;
        state.abilities=[];
        showEvent();
      `);
      forced = [success ? 0 : 0.999999];
      run('chooseEvent(0)');
      assert.equal(run('state.history.at(-1).success'), success);
      assert.equal(errors.length, 0);
    }
  };
  run('metaState=loadMeta();');
  if (start) {
    run(`
      setAllFive();
      selectedAbilities=['iron','memory','charmer'];
      selectedMotiveId='steady_home';
      startLife();
      state.targetMajor=99;
    `);
    assert.ok(run('state'));
  }
  api.seed(7);
  return api;
}

const featureState = g => g.json("Object.fromEntries(['fast_draw','reroll','branches'].map(id=>[id,featureUnlocked(id)]))");
const coreState = g => g.json('({age:state.age,body:state.body,mind:state.mind,charm:state.charm,family:state.family,majorDone:state.majorDone,history:state.history,legend:state.legend,lifeFlags:state.lifeFlags,occultFlags:state.occultFlags})');

test('fresh start keeps advanced controls locked, including direct function calls', () => {
  const g = game();
  assert.deepEqual(featureState(g), { fast_draw: false, reroll: false, branches: false });
  assert.equal(g.run("branchUnlocked('future_technology')"), false);
  assert.equal(g.run("branchEnabled('future_technology')"), false);
  g.run('renderStoryProgress(); refreshWheelAvailability();');
  assert.equal(g.nodes.spinBtn.disabled, false);
  const before = g.snapshot();
  g.run("fastDrawEvent(); rerollEvent(); spinWheel(true); openBranchManager('setup'); toggleBranchSetting('ordinary_career'); applyBranchPreset('all');");
  assert.equal(g.pending(), 0);
  assert.equal(g.run('currentEvent'), null);
  assert.equal(g.nodes.branchModal.classList.contains('on'), false);
  assert.deepEqual(g.snapshot(), before, 'locked calls must not spend random values, rerolls or save state');
  g.run('spinWheel()');
  g.flush();
  assert.ok(g.run('currentEvent'));
  assert.equal(g.errors.length, 0);
});

test('real choices unlock one tool at a time; failure cannot unlock everything at once', () => {
  for (const firstSuccess of [true, false]) {
    const g = game();
    g.choice(firstSuccess);
    assert.deepEqual(featureState(g), { fast_draw: true, reroll: false, branches: false });
    g.choice(false);
    assert.deepEqual(featureState(g), { fast_draw: true, reroll: true, branches: false });
    const before = g.json('metaState.storyProgress');
    g.run("evaluateStoryProgress('choice',{success:false});");
    assert.deepEqual(g.json('metaState.storyProgress'), before, 're-evaluating the same choice does not repeat unlocks');
    assert.equal(g.errors.length, 0);
  }
});

test('three successful decisions still unlock reroll and normal reroll accounting works', () => {
  const g = game();
  g.choice(true);
  g.choice(true);
  assert.equal(g.run("featureUnlocked('reroll')"), false);
  g.choice(true);
  assert.equal(g.run("featureUnlocked('reroll')"), true);
  g.run('resetWheelUI(); fastDrawEvent();');
  g.flush();
  const stage = g.run('state.majorDone');
  g.run('rerollEvent()');
  g.flush();
  assert.equal(g.run('rerollCountThisStage'), 1);
  assert.equal(g.run('state.majorDone'), stage);
  assert.equal(g.errors.length, 0);
});

test('first completed life unlocks branch planning once and saves the unlock across reincarnation', () => {
  const g = game();
  g.choice(true);
  g.run("state.dead=true; state.deathAge=state.age; state.deathCause='测试结算'; finishLife();");
  assert.equal(g.run("featureUnlocked('branches')"), true);
  assert.equal(g.run('metaState.lives'), 1);
  const before = g.snapshot();
  g.run('finishLife();');
  assert.deepEqual(g.snapshot(), before);
  const h = game({ storageEntries: [...g.storage] });
  assert.equal(h.run("featureUnlocked('branches')"), true);
  assert.equal(h.run('metaState.lives'), 1);
  assert.equal(g.errors.length + h.errors.length, 0);
});

test('direct rebirth settles the first life and persists branch planning without double counting', () => {
  for (const alreadyFinished of [false, true]) {
    const g = game();
    g.run("confirm=()=>true; state.dead=true; state.deathAge=state.age; state.deathCause='测试直接重生';");
    if (alreadyFinished) g.run('finishLife();');
    g.run('quickRebirth();');
    assert.equal(g.run('metaState.lives'), 1);
    assert.equal(g.run('state.lifeCounted'), true);
    assert.equal(g.run('state.narrative.endingWritten'), true);
    assert.equal(g.run("featureUnlocked('branches')"), true);
    assert.equal(g.storage.has('random_life_legacy_save_v1'), false);
    const saved = JSON.parse(g.storage.get('random_life_legacy_meta_v1'));
    assert.equal(saved.lives, 1);
    assert.ok(saved.storyProgress.unlocked.includes('branches'));
    const before = g.snapshot();
    g.run('quickRebirth();');
    assert.deepEqual(g.snapshot(), before, 'repeated direct rebirth neither counts another life nor duplicates its ending');
    assert.equal(g.errors.length, 0);
  }
});

test('legacy meta keeps existing tools, branches, bonuses and counts after migration', () => {
  const seed = game();
  const legacyMeta = seed.json('metaState');
  delete legacyMeta.storyProgress;
  legacyMeta.lives = 6;
  legacyMeta.bonus.mind = 8;
  legacyMeta.unlockedBranches.push('future_technology', 'otherworld');
  legacyMeta.branchPreferences.future_technology = false;
  const g = game({ start: false, storageEntries: [['random_life_legacy_meta_v1', JSON.stringify(legacyMeta)]] });
  assert.deepEqual(featureState(g), { fast_draw: true, reroll: true, branches: true });
  assert.equal(g.run('metaState.lives'), 6);
  assert.equal(g.run('metaState.bonus.mind'), 8);
  assert.equal(g.run("branchUnlocked('otherworld')"), true);
  assert.equal(g.run("branchUnlocked('future_technology')"), true);
  assert.equal(g.run('metaState.branchPreferences.future_technology'), false);
  const migrated = g.json('metaState');
  g.run('saveMeta(); metaState=loadMeta();');
  assert.deepEqual(g.json('metaState'), migrated);
});

test('existing life with no meta still migrates without resetting its history or granting another life', () => {
  const seed = game();
  const oldLife = seed.json('state');
  delete oldLife.narrative;
  delete oldLife.storyVersion;
  delete oldLife.storyProgressVersion;
  delete oldLife.storyProgressSeenChoices;
  oldLife.history = [{ age: 18, category: '学业', title: '旧日记录', choice: '原来的选择', success: true }];
  oldLife.majorDone = 1;
  oldLife.age = 36;
  Object.assign(oldLife.activeBranches, { occult_urban: true, machine_contact: true, otherworld: false, unknown_branch: true });
  const g = game({ start: false, storageEntries: [['random_life_legacy_save_v1', JSON.stringify(oldLife)]] });
  g.runInit();
  assert.deepEqual(featureState(g), { fast_draw: true, reroll: true, branches: true });
  assert.deepEqual(g.json('state.history'), oldLife.history);
  assert.deepEqual(g.json('state.yearlyLog'), oldLife.yearlyLog);
  assert.equal(g.run('metaState.lives'), 0);
  assert.equal(g.run('state.majorDone'), 1);
  assert.equal(g.run("branchUnlocked('occult_urban')"), true);
  assert.equal(g.run("branchUnlocked('machine_contact')"), true);
  assert.equal(g.run("branchUnlocked('otherworld')"), false);
  assert.equal(g.run("branchUnlocked('unknown_branch')"), false);
  const h = game({ start: false, storageEntries: [...g.storage] });
  h.runInit();
  assert.deepEqual(featureState(h), { fast_draw: true, reroll: true, branches: true }, 'migration must remain preserved on the second actual startup');
  assert.equal(h.run("branchUnlocked('future_technology')"), true);
});

test('pending and resolved choices cannot be replaced by extra draws or spend rerolls', () => {
  const g = game();
  g.choice(true); g.choice(true); g.choice(true);
  g.run("resetWheelUI(); currentEvent=fallbackEvent('学业');currentEvent.category='学业';showEvent();");
  const waiting = g.snapshot();
  g.run('fastDrawEvent();spinWheel();');
  assert.equal(g.pending(), 0);
  assert.deepEqual(g.snapshot(), waiting, 'an unanswered choice cannot be silently replaced');
  g.run('rerollEvent();');
  g.flush();
  assert.equal(g.run('rerollCountThisStage'), 1, 'an explicit reroll is still available before answering');
  g.run("currentEvent=fallbackEvent('学业');currentEvent.category='学业';showEvent();");
  g.seed(5, [0]);
  g.run('chooseEvent(0);');
  assert.equal(g.nodes.result.classList.contains('on'), true);
  assert.equal(g.nodes.spinBtn.disabled, true);
  assert.equal(g.nodes.fastSpinBtn.disabled, true);
  const resolved = g.snapshot();
  const rerolls = g.run('rerollCountThisStage');
  g.run('fastDrawEvent();spinWheel();spinWheel(true);rerollEvent();');
  assert.equal(g.pending(), 0);
  assert.equal(g.run('rerollCountThisStage'), rerolls);
  assert.deepEqual(g.snapshot(), resolved, 'a completed choice cannot spend another reroll or advance probability');
  g.run('resetWheelUI();fastDrawEvent();');
  assert.ok(g.pending() > 0, 'the next stage can draw again after the result is cleared');
  g.flush();
  assert.equal(g.errors.length, 0);
});

test('new progress survives save/reload and render calls never grant more features', () => {
  const g = game();
  g.choice(true);
  g.run('saveMeta();saveLife();');
  const before = g.json('metaState.storyProgress');
  const h = game({ start: false, storageEntries: [...g.storage] });
  h.run('state=loadLife();normalizeLife();');
  assert.deepEqual(h.json('metaState.storyProgress'), before);
  const snapshot = h.snapshot();
  h.run('renderStoryProgress();renderStoryProgress();renderAll();');
  assert.deepEqual(h.snapshot(), snapshot);
  assert.deepEqual(featureState(h), { fast_draw: true, reroll: false, branches: false });
});

test('absent, null and corrupt meta records start fresh instead of accidentally unlocking everything', () => {
  for (const raw of [null, 'null', '{']) {
    const storageEntries = raw === null ? [] : [['random_life_legacy_meta_v1', raw]];
    const g = game({ start: false, storageEntries });
    assert.deepEqual(featureState(g), { fast_draw: false, reroll: false, branches: false });
    assert.equal(g.run("branchUnlocked('future_technology')"), false);
  }
});

test('technology discovery is earned by story and becomes selectable for the next life', () => {
  const g = game();
  assert.equal(g.run("branchUnlocked('future_technology')"), false);
  g.choice(true, '时代');
  assert.equal(g.run("branchUnlocked('future_technology')"), false, 'one early event cannot expose the advanced world');
  for (let i = 0; i < 3 && !g.run("branchUnlocked('future_technology')"); i++) g.choice(true, '时代');
  assert.equal(g.run("branchUnlocked('future_technology')"), true);
  assert.ok(g.run("state.yearlyLog.some(item=>item.text.includes('时代的来信'))"), 'technology unlock must leave its specific story in the life review');
  assert.equal(g.run("branchEnabled('future_technology')"), false, 'the current life keeps its original branch configuration');
  g.run('saveMeta();');
  const h = game({ storageEntries: [...g.storage] });
  assert.equal(h.run("branchEnabled('future_technology')"), true);
});

test('childhood scenes are stable per life, varied across lives, and consume no gameplay randomness', () => {
  const g = game();
  const scenes = g.json('Array.from({length:18},(_,age)=>narrativeChildhoodText(age,state.initialStats))');
  assert.equal(new Set(scenes).size, 18);
  assert.ok(scenes.every(text => text.length >= 30), 'each year contains an actual scene');
  const before = g.calls();
  const again = g.json('Array.from({length:18},(_,age)=>narrativeChildhoodText(age,state.initialStats))');
  assert.deepEqual(again, scenes);
  assert.equal(g.calls(), before);
  const h = game();
  h.run('state.childhoodVariantSeed+=138; delete state.narrative;');
  const other = h.json('Array.from({length:18},(_,age)=>narrativeChildhoodText(age,state.initialStats))');
  assert.ok(other.filter((text, i) => text !== scenes[i]).length >= 9, 'a new seed creates a recognizably different childhood');
});

test('annual story scenes append once per age without changing gameplay state or random sequence', () => {
  const g = game();
  const before = coreState(g), calls = g.calls();
  for (let age = 19; age <= 42; age++) {
    g.run(`advanceNarrativeYear(${age});`);
    const written = g.json('state.yearlyLog');
    g.run(`advanceNarrativeYear(${age});`);
    assert.deepEqual(g.json('state.yearlyLog'), written, `age ${age} cannot duplicate a scene`);
  }
  assert.deepEqual(coreState(g), before);
  assert.equal(g.calls(), calls);
  const scenes = g.json('state.yearlyLog.filter(item=>item.age>=19&&item.age<=42)');
  assert.ok(scenes.length >= 18);
  assert.equal(new Set(scenes.map(item => item.text)).size, scenes.length);
  assert.equal(g.errors.length, 0);
});

test('choice echoes preserve real outcomes, appear later, and survive a save/reload', () => {
  const g = game();
  g.run(`
    recordNarrativeChoice({id:'echo_test',title:'一封没有寄出的申请',category:'事业'}, {text:'留下修改方案'}, false, 23);
  `);
  const echoes = g.json('state.narrative.echoes');
  const echo = echoes.find(item => item.eventId === 'echo_test');
  assert.ok(echo);
  assert.equal(echo.success, false);
  assert.equal(echo.choice, '留下修改方案');
  assert.ok(echo.due > 23);
  const size = echoes.length;
  g.run("recordNarrativeChoice({id:'echo_test',title:'一封没有寄出的申请',category:'事业'}, {text:'留下修改方案'}, false, 23);");
  assert.equal(g.run('state.narrative.echoes.length'), size);
  g.run('saveMeta();saveLife();');
  const h = game({ start: false, storageEntries: [...g.storage] });
  h.run('state=loadLife();normalizeLife();');
  h.run(`advanceNarrativeYear(${echo.due});`);
  const log = h.json(`state.yearlyLog.find(item=>item.age===${echo.due})`);
  assert.match(log.text, /一封没有寄出的申请/);
  assert.match(log.text, /留下修改方案/);
  assert.equal(h.calls(), 0);
  assert.equal(g.errors.length + h.errors.length, 0);
});

test('narrative save/reload and ending are idempotent without rewriting old years', () => {
  const g = game();
  g.run('advanceNarrativeYear(19); advanceNarrativeYear(20); saveLife(); saveMeta();');
  const narrative = g.json('state.narrative');
  const logs = g.json('state.yearlyLog');
  const h = game({ start: false, storageEntries: [...g.storage] });
  h.run('state=loadLife();normalizeLife();ensureNarrativeState();');
  assert.deepEqual(h.json('state.narrative'), narrative);
  assert.deepEqual(h.json('state.yearlyLog'), logs);
  h.run('state.age=80; state.dead=true; finishNarrativeLife();');
  const finished = h.json('state.yearlyLog');
  h.run('finishNarrativeLife();');
  assert.deepEqual(h.json('state.yearlyLog'), finished);
  assert.deepEqual(finished.filter(item => item.age < 80), logs);
  assert.equal(h.run('state.narrative.endingWritten'), true);
  assert.equal(h.calls(), 0);
});

test('linked stories unfold in order and stop advancing when their world is left behind', () => {
  const g = game();
  const definitions = g.json('narrativeArcs.map(({id,era,gap,steps})=>({id,era,gap,length:steps.length}))');
  for (let age = 18; age <= 38; age++) {
    const before = g.json('state.narrative.arcs');
    g.run(`advanceNarrativeYear(${age});`);
    const after = g.json('state.narrative.arcs');
    let beats = 0;
    for (const [id, progress] of Object.entries(after)) {
      const old = before[id];
      const delta = progress.step - (old?.step || 0);
      assert.ok(delta === 0 || delta === 1, `${id} must not skip a plot beat`);
      beats += delta;
      if (delta && old) assert.ok(age - old.lastAge >= definitions.find(item => item.id === id).gap);
    }
    assert.ok(beats <= 1, 'at most one linked story advances each year');
  }
  assert.ok(g.run('Object.values(state.narrative.arcs).some(arc=>arc.completedAt!==undefined)'), 'a natural life should reach a story ending');
  const modern = g.json('state.narrative.arcs');
  g.run("state.era='awakening';");
  for (let age = 39; age <= 50; age++) g.run(`advanceNarrativeYear(${age});`);
  for (const [id, progress] of Object.entries(modern)) {
    assert.deepEqual(g.json(`state.narrative.arcs[${JSON.stringify(id)}]`), progress, 'ordinary-world stories do not continue as if the world never changed');
  }
  assert.ok(g.run("state.yearlyLog.some(item=>item.age>=39&&item.text.includes('异常'))"));
  const before = g.json('state.yearlyLog');
  g.run('state.pendingDaoChoice=true;advanceNarrativeYear(51);state.pendingDaoChoice=false;state.dead=true;advanceNarrativeYear(52);');
  assert.deepEqual(g.json('state.yearlyLog'), before, 'pending transitions and death do not silently append more life');
  assert.equal(g.calls(), 0);
});
