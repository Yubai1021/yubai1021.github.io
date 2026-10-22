'use strict';

// Run: node --test games/life/tests/expansion.test.cjs
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
        resetWheelUI();
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

const gameplay = g => g.json(`({age:state.age,body:state.body,mind:state.mind,charm:state.charm,family:state.family,
  majorDone:state.majorDone,targetMajor:state.targetMajor,history:state.history,legend:state.legend,
  lifeFlags:state.lifeFlags,occultFlags:state.occultFlags,lifeTracks:state.lifeTracks,
  dead:state.dead,ended:state.ended,lives:metaState.lives,bonus:metaState.bonus,inherited:metaState.inherited})`);

test('expanded event catalog is registered once with unique IDs, readable choices and valid effect ranges', () => {
  const g = game();
  const events = g.json('expansionEvents');
  assert.ok(events.length >= 100, 'a substantial catalog expansion is present');
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
  assert.equal(new Set(events.map(e => e.title)).size, events.length);
  const modern = new Set(g.json('modernCategories'));
  const knownBranches = new Set(g.json('branchDefinitions.map(branch=>branch.id)'));
  const knownPaths = new Set(g.json('cultivationPaths.map(path=>path.id)'));
  const realmCount = g.run('realmConfigs.length');
  const categoryCount = new Map();
  for (const event of events) {
    assert.match(event.id, /^rich_/);
    assert.ok(typeof event.title === 'string' && event.title.trim().length >= 2 && typeof event.desc === 'string' && event.desc.trim().length >= 10, event.id);
    assert.ok(g.run(`Array.isArray(eventBank[${JSON.stringify(event.category)}])`), event.category);
    if (event.branchKey) assert.ok(knownBranches.has(event.branchKey), `${event.id}: known branch prerequisite`);
    if (event.minAge !== undefined) assert.ok(Number.isInteger(event.minAge) && event.minAge >= 0, event.id);
    if (event.maxAge !== undefined) assert.ok(Number.isInteger(event.maxAge) && event.maxAge >= (event.minAge || 0), event.id);
    if (event.minRealm !== undefined) assert.ok(Number.isInteger(event.minRealm) && event.minRealm >= 0 && event.minRealm < realmCount, event.id);
    if (event.maxRealm !== undefined) assert.ok(Number.isInteger(event.maxRealm) && event.maxRealm >= (event.minRealm || 0), event.id);
    for (const selectedPath of event.paths || []) assert.ok(knownPaths.has(selectedPath), `${event.id}: known cultivation path`);
    categoryCount.set(event.category, (categoryCount.get(event.category) || 0) + 1);
    assert.ok(Array.isArray(event.choices) && event.choices.length >= 3, event.id);
    assert.equal(new Set(event.choices.map(c => c.text)).size, event.choices.length, event.id);
    for (const choice of event.choices) {
      assert.ok(choice.text && choice.success && choice.fail, event.id);
      assert.notEqual(choice.success, choice.fail, event.id);
      for (const [stat, range] of Object.entries(choice.fx || {})) {
        assert.ok(['body', 'mind', 'charm', 'family'].includes(stat), `${event.id}: supported attribute`);
        assert.equal(range.length, 2, event.id);
        assert.ok(range.every(Number.isInteger) && range[0] <= range[1], event.id);
        assert.ok(range[0] >= -6 && range[1] <= 6, `${event.id}: effects are bounded`);
      }
    }
    assert.ok(event.choices.some(choice => !g.run(`choiceLockReason(${JSON.stringify(choice)})`)), `${event.id}: at least one choice remains possible without extra legacy requirements`);
  }
  for (const category of modern) assert.ok(categoryCount.get(category) >= 3, `${category} has meaningful new coverage`);
  const before = g.json('Object.fromEntries(Object.entries(eventBank).map(([category,events])=>[category,events.length]))');
  const calls = g.calls();
  g.run('registerExpansionEvents();registerExpansionEvents();');
  assert.deepEqual(g.json('Object.fromEntries(Object.entries(eventBank).map(([category,events])=>[category,events.length]))'), before);
  for (const event of events) assert.equal(g.run(`Object.values(eventBank).flat().filter(e=>e.id===${JSON.stringify(event.id)}).length`), 1);
  assert.equal(g.calls(), calls, 'registering content never consumes gameplay randomness');
});

test('expanded events respect age and locked branch requirements in the real availability filter', () => {
  const g = game();
  const events = g.json('expansionEvents');
  for (const event of events) {
    const literal = JSON.stringify(event);
    if (event.minAge !== undefined) {
      g.run(`state.age=${event.minAge - 1};`);
      assert.equal(g.run(`eventAvailable(${literal},${JSON.stringify(event.category)})`), false, `${event.id}: too young`);
    }
    if (event.maxAge !== undefined) {
      g.run(`state.age=${event.maxAge + 1};`);
      assert.equal(g.run(`eventAvailable(${literal},${JSON.stringify(event.category)})`), false, `${event.id}: too old`);
    }
    if (event.branchKey && !event.branchDiscovery) {
      g.run(`state.age=${event.minAge || 30};state.activeBranches[${JSON.stringify(event.branchKey)}]=false;`);
      assert.equal(g.run(`eventAvailable(${literal},${JSON.stringify(event.category)})`), false, `${event.id}: disabled branch`);
      g.run(`delete state.activeBranches[${JSON.stringify(event.branchKey)}];`);
    }
    if (event.eras || event.requiresWorld) {
      g.run(`{
        const candidate=${literal};
        if(candidate.branchKey){if(!metaState.unlockedBranches.includes(candidate.branchKey))metaState.unlockedBranches.push(candidate.branchKey);state.activeBranches[candidate.branchKey]=true;}
        state.age=candidate.minAge||30;state.realmIndex=candidate.minRealm||1;state.era=candidate.eras?.[0]||'cultivation';state.worldsUnlocked=true;
        state.lifeFlags={...(candidate.requiresLife||{})};state.occultFlags={...(candidate.requires||{})};
      }`);
      assert.equal(g.run(`eventAvailable(${literal},${JSON.stringify(event.category)})`), true, `${event.id}: declared gates can be met`);
      if (event.eras) {
        const wrongEra = ['modern', 'awakening', 'cultivation'].find(era => !event.eras.includes(era));
        if (wrongEra) {
          g.run(`state.era=${JSON.stringify(wrongEra)};`);
          assert.equal(g.run(`eventAvailable(${literal},${JSON.stringify(event.category)})`), false, `${event.id}: wrong world is rejected`);
          g.run(`state.era=${JSON.stringify(event.eras[0])};`);
        }
      }
      if (event.requiresWorld) {
        g.run('state.worldsUnlocked=false;');
        assert.equal(g.run(`eventAvailable(${literal},${JSON.stringify(event.category)})`), false, `${event.id}: unlocked branch alone does not open the world gate`);
      }
    }
  }
  g.run("metaState=defaultMeta();state.age=18;state.era='modern';state.worldsUnlocked=false;state.realmIndex=0;state.lifeFlags={};state.occultFlags={};state.activeBranches=activeBranchDefaults();");
  for (const category of g.json('modernCategories')) {
    const pool = g.json(`getSafeEventPool(${JSON.stringify(category)})`);
    assert.ok(pool.length > 0);
    assert.ok(pool.every(e => !String(e.id || '').startsWith('fallback_')), `${category}: a fresh player still has natural events`);
    for (const event of pool.filter(e => String(e.id || '').startsWith('rich_'))) {
      assert.ok(event.minAge === undefined || event.minAge <= 18);
      assert.ok(event.maxAge === undefined || event.maxAge >= 18);
      assert.ok(!['future_technology', 'machine_contact', 'machine_governance', 'otherworld', 'cultivation_hidden'].includes(event.branchKey), `${event.id}: no locked-world leak`);
    }
  }
  assert.equal(g.calls(), 0);
});

test('major choices reject invalid indices and double activation before any side effect', () => {
  const g = game();
  g.run("currentEvent=fallbackEvent('学业');currentEvent.category='学业';currentEvent.id='double_choice';showEvent();");
  const waiting = g.snapshot();
  const enabled = g.nodes.choices.children.map(button => button.disabled);
  g.run('chooseEvent(-1);chooseEvent(100);chooseEvent(0.5);chooseEvent(NaN);chooseEvent(undefined);');
  assert.deepEqual(g.snapshot(), waiting);
  assert.deepEqual(g.nodes.choices.children.map(button => button.disabled), enabled, 'invalid input must not disable legitimate options');
  g.run('chooseEvent(0);');
  assert.equal(g.run('state.history.length'), 1);
  const resolved = g.snapshot();
  g.run('chooseEvent(0);chooseEvent(1);');
  assert.deepEqual(g.snapshot(), resolved, 'a resolved choice cannot award another result');
  assert.equal(g.calls(), resolved.randomCalls);
  assert.equal(g.errors.length, 0);
});

test('life wishes unlock after one life and freeze at the beginning without changing core stats or RNG', () => {
  const g = game({ start: false });
  const fresh = g.json('metaState.exploration');
  g.run("selectLifeWish('long_view');");
  assert.deepEqual(g.json('metaState.exploration'), fresh, 'first-time players do not receive an extra setup decision');
  g.run("metaState.lives=1;selectLifeWish('long_view');");
  assert.equal(g.run('metaState.exploration.selectedWish'), 'long_view');
  const control = game({ start: false });
  control.run('metaState.lives=1;');
  for (const player of [g, control]) {
    player.seed(123);
    player.run("setAllFive();selectedAbilities=['iron','memory','charmer'];selectedMotiveId='steady_home';startLife();");
  }
  assert.equal(g.run('state.exploration.wishId'), 'long_view');
  assert.equal(control.run('state.exploration.wishId'), null);
  assert.deepEqual(gameplay(g), gameplay(control));
  assert.equal(g.calls(), control.calls(), 'choosing a wish does not alter the random stream');
  const frozen = g.json('state.exploration');
  const selected = g.run('metaState.exploration.selectedWish');
  g.run("selectLifeWish('many_roads');selectLifeWish(null);");
  assert.deepEqual(g.json('state.exploration'), frozen);
  assert.equal(g.run('metaState.exploration.selectedWish'), selected, 'a running life cannot change its wish');
});

test('old discovery counters migrate as sightings without inventing endings, wishes or historical lives', () => {
  const seed = game();
  const known = seed.run("eventBank['学业'][0].id||eventBank['学业'][0].title");
  const old = seed.json('metaState');
  delete old.exploration;
  old.lives = 8;
  old.bonus.mind = 4;
  old.globalEventSeenCounts = { [known]: 3 };
  const g = game({ start: false, storageEntries: [['random_life_legacy_meta_v1', JSON.stringify(old)]] });
  assert.deepEqual(g.json('metaState.exploration.seenEvents'), [known]);
  for (const key of ['storyEndings', 'fulfilledWishes', 'lives', 'resolvedEvents']) assert.deepEqual(g.json(`metaState.exploration.${key}`), []);
  assert.equal(g.run('metaState.lives'), 8);
  assert.equal(g.run('metaState.bonus.mind'), 4);
  g.run('saveMeta();metaState=loadMeta();');
  const normalized = g.json('metaState');
  g.run('normalizeExplorationMeta(metaState);');
  assert.deepEqual(g.json('metaState'), normalized);
  g.run("setAllFive();selectedAbilities=['iron','memory','charmer'];selectedMotiveId='steady_home';startLife();state.body=20;state.mind=20;state.charm=20;state.family=20;");
  g.run(`currentEvent={...eventBank['学业'].find(e=>(e.id||e.title)===${JSON.stringify(known)}),category:'学业'};showEvent();chooseEvent(currentEvent.choices.findIndex(c=>!choiceLockReason(c)));`);
  assert.ok(!g.json('state.exploration.newEvents').includes(known), 'a previously seen event is not a new discovery');
  assert.ok(g.json('metaState.exploration.resolvedEvents').includes(known), 'the new actual decision is recorded');
});

test('draws and decisions have distinct discovery records and repeated choice hooks are idempotent', () => {
  const g = game();
  g.run("state.body=20;state.mind=20;state.charm=20;state.family=20;currentEvent={...getSafeEventPool('学业')[0],category:'学业'};recordExplorationDraw(currentEvent);");
  const id = g.run('currentEvent.id||currentEvent.title');
  assert.ok(g.json('metaState.exploration.seenEvents').includes(id));
  assert.ok(!g.json('metaState.exploration.resolvedEvents').includes(id));
  assert.deepEqual(g.json('state.exploration.newEvents'), []);
  g.run('showEvent();chooseEvent(currentEvent.choices.findIndex(c=>!choiceLockReason(c)));');
  assert.ok(g.json('metaState.exploration.resolvedEvents').includes(id));
  assert.deepEqual(g.json('state.exploration.newEvents'), [id]);
  const after = g.snapshot();
  g.run('recordExplorationChoice(currentEvent,currentEvent.choices[0],true);recordExplorationChoice(currentEvent,currentEvent.choices[0],true);');
  assert.deepEqual(g.snapshot(), after);
  g.run('saveMeta();saveLife();');
  const h = game({ start: false, storageEntries: [...g.storage] });
  h.run('state=loadLife();normalizeLife();');
  assert.deepEqual(h.json('state.exploration'), g.json('state.exploration'));
  assert.deepEqual(h.json('metaState.exploration'), g.json('metaState.exploration'));
});

test('wish fulfillment and first-life shelf settlement remain idempotent through both ending paths', () => {
  for (const direct of [false, true]) {
    const g = game({ start: false });
    g.run("metaState.lives=1;selectLifeWish('long_view');setAllFive();selectedAbilities=['iron','memory','charmer'];selectedMotiveId='steady_home';startLife();state.age=60;state.dead=true;state.deathAge=60;state.deathCause='测试中的终章';");
    const before = gameplay(g);
    g.run('updateLifeWish();');
    assert.equal(g.run('state.exploration.wishFulfilled'), true);
    assert.deepEqual(g.json('metaState.exploration.fulfilledWishes'), ['long_view']);
    assert.deepEqual(gameplay(g), before, 'a wish grants no hidden gameplay advantage');
    const year = g.json('state.yearlyLog');
    g.run('updateLifeWish();');
    assert.deepEqual(g.json('state.yearlyLog'), year);
    if (direct) g.run('confirm=()=>true;quickRebirth();');
    else g.run('finishLife();');
    assert.equal(g.run('metaState.lives'), 2);
    assert.equal(g.run('metaState.exploration.lives.length'), 1);
    assert.equal(g.run('metaState.exploration.totalRecorded'), 1);
    assert.equal(g.run('state.exploration.settled'), true);
    const settled = g.json('metaState.exploration');
    const calls = g.calls();
    g.run('settleExplorationLife();settleExplorationLife();');
    if (direct) g.run('quickRebirth();');
    else g.run('finishLife();');
    assert.deepEqual(g.json('metaState.exploration'), settled);
    assert.equal(g.calls(), calls);
    assert.equal(g.run('metaState.lives'), 2);
    const saved = JSON.parse(g.storage.get('random_life_legacy_meta_v1'));
    assert.deepEqual(saved.exploration, settled);
  }
});

test('exploration rendering and page filters leave persisted progress and gameplay randomness unchanged', () => {
  const g = game();
  const before = g.snapshot();
  g.run("renderExploration();selectExplorationTab('events');filterExplorationEvents('学业');pageExplorationEvents(1);selectExplorationTab('stories');renderExploration();selectExplorationTab('milestones');renderExploration();selectExplorationTab('lives');");
  assert.deepEqual(g.snapshot(), before);
  assert.equal(g.errors.length, 0);
});

test('partial or malformed exploration records normalize into a renderable and finite save', () => {
  const g = game();
  g.run(`metaState.exploration={version:1,seenEvents:['x','x',null],resolvedEvents:'bad',storyEndings:[null,{id:'story:e'}],lives:[{id:'partial',categories:null,stories:'bad'}],totalRecorded:Infinity};
    state.exploration={processedChoices:Infinity};normalizeExplorationMeta(metaState);ensureExplorationLife();`);
  assert.ok(g.run('Number.isFinite(metaState.exploration.totalRecorded)'));
  assert.ok(g.run('Number.isFinite(state.exploration.processedChoices)'));
  assert.equal(g.run('typeof state.exploration.lifeId'), 'string');
  assert.ok(g.run('state.exploration.lifeId.length>0'));
  g.run("selectExplorationTab('lives');renderExploration();selectExplorationTab('stories');renderExploration();selectExplorationTab('events');renderExploration();selectExplorationTab('milestones');renderExploration();");
  const before = g.json('({meta:metaState.exploration,life:state.exploration})');
  g.run('normalizeExplorationMeta(metaState);ensureExplorationLife();');
  assert.deepEqual(g.json('({meta:metaState.exploration,life:state.exploration})'), before);
  assert.equal(g.calls(), 0);
});

test('life shelf keeps its most recent 24 summaries while lifetime milestones retain the total', () => {
  const g = game();
  g.run(`for(let index=0;index<27;index++){
    state=null;setAllFive();selectedAbilities=['iron','memory','charmer'];selectedMotiveId='steady_home';startLife();
    state.dead=true;state.deathAge=state.age;state.deathCause='书架容量测试';finishLife();
  }`);
  assert.equal(g.run('metaState.lives'), 27);
  assert.equal(g.run('metaState.exploration.lives.length'), 24);
  assert.equal(g.run('metaState.exploration.totalRecorded'), 27);
  assert.equal(g.run('metaState.exploration.lives[0].number'), 4);
  assert.equal(g.run('metaState.exploration.lives.at(-1).number'), 27);
  assert.ok(g.json('metaState.exploration.milestones').includes('ten_volumes'));
  const before = gameplay(g);
  g.run("selectExplorationTitle('ten_volumes');");
  assert.deepEqual(gameplay(g), before, 'wearing a collected title changes no gameplay statistics');
  assert.equal(g.run('metaState.exploration.selectedTitle'), 'ten_volumes');
});

test('resetting all lives clears discoveries and wishes as well as legacy progress', () => {
  const g = game();
  g.run("metaState.exploration.seenEvents=['a'];metaState.exploration.fulfilledWishes=['long_view'];metaState.exploration.selectedWish='long_view';metaState.lives=3;saveMeta();saveLife();confirm=()=>true;resetAllLives();");
  assert.equal(g.storage.has('random_life_legacy_meta_v1'), false);
  assert.equal(g.storage.has('random_life_legacy_save_v1'), false);
  const h = game({ storageEntries: [...g.storage] });
  assert.equal(h.run('metaState.lives'), 0);
  for (const key of ['seenEvents', 'storyEndings', 'fulfilledWishes', 'lives', 'milestones']) assert.deepEqual(h.json(`metaState.exploration.${key}`), []);
  assert.equal(h.run('state.exploration.wishId'), null);
});

function activateJourney(g, id) {
  g.run(`{
    const story=journeyById(${JSON.stringify(id)});
    state.era=story.era;state.age=Math.max(30,story.minAge||18);state.majorDone=2;state.targetMajor=99;
    state.dead=false;state.ended=false;state.lifeCompleted=false;state.pendingDaoChoice=false;
    state.worldsUnlocked=!!story.requiresWorlds;eventPanel.classList.remove('on');result.classList.remove('on');
    if(story.branchKey){if(!metaState.unlockedBranches.includes(story.branchKey))metaState.unlockedBranches.push(story.branchKey);state.activeBranches[story.branchKey]=true;}
    state.journeys={version:1,active:{id:story.id,chapter:0,choices:[],scores:{},startedAt:state.age,nextAge:state.age,lastReply:''},completed:[],seen:[story.id],abandoned:[],offered:1,lastOfferStage:2,lastChoiceStage:-1,finalized:false};
    ensureJourneyState();
  }`);
}

test('optional journeys appear after two decisions and never reveal locked worlds or auto-select a chapter', () => {
  const g = game();
  assert.equal(g.run('state.journeys.active'), null);
  g.run('updateJourneyOffer();state.majorDone=1;updateJourneyOffer();');
  assert.equal(g.run('state.journeys.active'), null);
  g.run("state.majorDone=2;eventPanel.classList.add('on');updateJourneyOffer();");
  assert.equal(g.run('state.journeys.active'), null);
  g.run("eventPanel.classList.remove('on');result.classList.add('on');updateJourneyOffer();");
  assert.equal(g.run('state.journeys.active'), null);
  g.run("result.classList.remove('on');updateJourneyOffer();");
  assert.ok(g.run('state.journeys.active'));
  assert.equal(g.run('journeyById(state.journeys.active.id).era'), 'modern');
  assert.equal(g.run('journeyWorldMatches(journeyById(state.journeys.active.id))'), true);
  assert.equal(g.run('state.journeys.active.chapter'), 0);
  const before = g.snapshot();
  g.run('updateJourneyOffer();renderJourneys();renderJourneys();');
  assert.deepEqual(g.snapshot(), before, 'offering or viewing a story is not a decision');
  assert.equal(g.calls(), 0);
});

test('every authored journey and ending can be completed through actual choices without gameplay bonuses', () => {
  const seed = game();
  const stories = seed.json('journeyDefinitions');
  assert.ok(stories.length >= 12);
  assert.equal(new Set(stories.map(story => story.id)).size, stories.length);
  const found = [];
  for (const story of stories) {
    assert.equal(story.chapters.length, 3, story.id);
    assert.ok(Object.keys(story.endings).length >= 3, story.id);
    for (const [route, ending] of Object.entries(story.endings)) {
      const g = game();
      activateJourney(g, story.id);
      for (let chapter = 0; chapter < story.chapters.length; chapter++) {
        const index = story.chapters[chapter].choices.findIndex(choice => choice.route === route);
        assert.ok(index >= 0, `${story.id}: ${route} has a choice in chapter ${chapter}`);
        if (chapter) g.run('state.age+=4;state.majorDone++;');
        const before = gameplay(g), calls = g.calls();
        assert.equal(g.run(`chooseJourneyOption(${index})`), true, `${story.id}: chapter ${chapter}`);
        assert.deepEqual(gameplay(g), before, 'story choices do not spend attributes or advance major decisions');
        assert.equal(g.calls(), calls);
      }
      assert.equal(g.run('state.journeys.active'), null);
      const completion = g.json('state.journeys.completed[0]');
      assert.equal(completion.endingId, ending.id, `${story.id}: ${route} ending is reachable`);
      assert.equal(completion.choices.length, 3);
      const record = g.json('metaState.exploration.storyEndings[0]');
      assert.equal(record.id, story.id + ':' + ending.id);
      assert.ok(record.text.includes(ending.text), 'the shelf preserves the actual ending prose');
      if (completion.text) assert.equal(record.text, completion.text, 'the shelf also preserves the earlier-choice echoes');
      assert.equal(g.run('state.exploration.newEndings.length'), 1);
      const after = g.snapshot();
      g.run('chooseJourneyOption(0);');
      assert.deepEqual(g.snapshot(), after, 'a completed chapter cannot be activated twice');
      found.push(record.id);
    }
  }
  assert.ok(found.length >= 36);
  assert.equal(new Set(found).size, found.length);
});

test('the final explicit journey decision determines its ending even when earlier choices favored another route', () => {
  const g = game();
  const story = g.json('journeyDefinitions[0]');
  const routes = Object.keys(story.endings);
  activateJourney(g, story.id);
  for (let chapter = 0; chapter < 3; chapter++) {
    if (chapter) g.run('state.age+=4;state.majorDone++;');
    const route = chapter === 2 ? routes[1] : routes[0];
    const index = story.chapters[chapter].choices.findIndex(choice => choice.route === route);
    assert.equal(g.run(`chooseJourneyOption(${index})`), true);
  }
  assert.equal(g.run('state.journeys.completed[0].endingId'), story.endings[routes[1]].id);
  assert.deepEqual(g.json('state.journeys.completed[0].choices.map(choice=>choice.route)'), [routes[0], routes[0], routes[1]], 'early choices remain in the record rather than being rewritten');
});

test('journey chapters require both elapsed years and another major stage, and reject invalid or closed-flow calls', () => {
  const g = game();
  activateJourney(g, 'repair_shop');
  let before = g.snapshot();
  g.run('chooseJourneyOption(-1);chooseJourneyOption(100);chooseJourneyOption(0.5);chooseJourneyOption(NaN);');
  assert.deepEqual(g.snapshot(), before);
  assert.equal(g.run('chooseJourneyOption(0)'), true);
  before = g.snapshot();
  g.run('chooseJourneyOption(0);');
  assert.deepEqual(g.snapshot(), before, 'immediate double clicks cannot advance');
  g.run('state.majorDone++;');
  before = g.snapshot();
  g.run('chooseJourneyOption(0);');
  assert.deepEqual(g.snapshot(), before, 'another stage alone does not skip the story time gap');
  g.run('state.age+=4;state.majorDone--;');
  before = g.snapshot();
  g.run('chooseJourneyOption(0);');
  assert.deepEqual(g.snapshot(), before, 'age alone does not produce another decision slot');
  g.run('state.majorDone++;');
  for (const [block, restore] of [
    ['state.dead=true;', 'state.dead=false;'],
    ['state.ended=true;', 'state.ended=false;'],
    ['state.pendingDaoChoice=true;', 'state.pendingDaoChoice=false;'],
    ['spinning=true;', 'spinning=false;'],
    ["eventPanel.classList.add('on');", "eventPanel.classList.remove('on');"],
    ["result.classList.add('on');", "result.classList.remove('on');"]
  ]) {
    g.run(block);before = g.snapshot();
    g.run('chooseJourneyOption(0);abandonJourney();updateJourneyOffer();');
    assert.deepEqual(g.snapshot(), before, block);
    g.run(restore);
  }
  assert.equal(g.run('chooseJourneyOption(0)'), true);
  assert.equal(g.run('state.journeys.active.chapter'), 2);
  assert.equal(g.calls(), 0);
});

test('journeys survive reload, suspend on world changes, and can be abandoned once without a fabricated ending', () => {
  const g = game();
  activateJourney(g, 'repair_shop');
  g.run('chooseJourneyOption(0);saveMeta();saveLife();');
  const h = game({ start: false, storageEntries: [...g.storage] });
  h.run('state=loadLife();normalizeLife();');
  assert.deepEqual(h.json('state.journeys'), g.json('state.journeys'));
  h.run("state.age+=4;state.majorDone++;state.era='awakening';");
  const before = h.snapshot();
  h.run('chooseJourneyOption(0);renderJourneys();');
  assert.deepEqual(h.snapshot(), before, 'an ordinary-world story cannot proceed after the world is left behind');
  assert.equal(h.run('abandonJourney()'), true);
  assert.equal(h.run('state.journeys.active'), null);
  assert.equal(h.run('state.journeys.abandoned.length'), 1);
  assert.equal(h.run('state.journeys.completed.length'), 0);
  assert.equal(h.run('metaState.exploration.storyEndings.length'), 0);
  const abandoned = h.snapshot();
  h.run('abandonJourney();updateJourneyOffer();');
  assert.deepEqual(h.snapshot(), abandoned, 'abandonment cannot immediately offer and farm another story');
});

test('unfinished journeys close once without inventing unchosen chapters, and finalization is safe on reload', () => {
  const g = game();
  activateJourney(g, 'repair_shop');
  g.run('chooseJourneyOption(0);state.dead=true;state.deathCause="测试中的终章";finishLife();');
  assert.equal(g.run('state.journeys.finalized'), true);
  assert.equal(g.run('state.journeys.active.chapter'), 1);
  assert.equal(g.run('state.journeys.completed.length'), 0);
  assert.equal(g.run('metaState.exploration.storyEndings.length'), 0);
  const before = g.snapshot();
  g.run('finalizeJourneys();finishLife();');
  assert.deepEqual(g.snapshot(), before);
  const h = game({ start: false, storageEntries: [...g.storage] });
  h.run('state=loadLife();normalizeLife();finalizeJourneys();');
  assert.deepEqual(h.json('state.journeys'), g.json('state.journeys'));
  assert.deepEqual(h.json('state.yearlyLog'), g.json('state.yearlyLog'));
});

test('journey offers prefer stories with fewer collected endings using the persisted array schema', () => {
  const g = game();
  g.run(`state.age=30;state.majorDone=2;state.journeys=null;
    const eligible=journeyDefinitions.filter(story=>journeyWorldMatches(story)&&state.age>=(story.minAge||18)&&state.age<=(story.maxAge??Infinity));
    globalThis.freshStoryId=eligible[0].id;
    metaState.exploration.storyEndings=eligible.slice(1).flatMap(story=>Object.values(story.endings).map(ending=>({id:story.id+':'+ending.id,storyId:story.id,title:story.title,endingTitle:ending.title,text:ending.text})));
    updateJourneyOffer();`);
  assert.equal(g.run('state.journeys.active.id'), g.run('freshStoryId'), 'a known catalog entry must affect the choice of the next new story');
  assert.equal(g.calls(), 0);
});

test('replaying the same ending does not count as a new ending, while a different route is collected', () => {
  const g = game();
  const story = g.json("journeyById('repair_shop')");
  const routes = Object.keys(story.endings);
  function finishRoute(player, route) {
    activateJourney(player, story.id);
    for (let chapter = 0; chapter < 3; chapter++) {
      if (chapter) player.run('state.age+=4;state.majorDone++;');
      const index = story.chapters[chapter].choices.findIndex(choice => choice.route === route);
      player.run(`chooseJourneyOption(${index});`);
    }
  }
  finishRoute(g, routes[0]);
  g.run('saveMeta();');
  const h = game({ storageEntries: [["random_life_legacy_meta_v1", g.storage.get('random_life_legacy_meta_v1')]] });
  finishRoute(h, routes[0]);
  assert.equal(h.run('metaState.exploration.storyEndings.length'), 1);
  assert.deepEqual(h.json('state.exploration.newEndings'), []);
  finishRoute(h, routes[1]);
  assert.equal(h.run('metaState.exploration.storyEndings.length'), 2);
  assert.deepEqual(h.json('state.exploration.newEndings'), [story.id + ':' + story.endings[routes[1]].id]);
  assert.ok(h.json('metaState.exploration.milestones').includes('another_answer'));
  assert.equal(h.calls(), 0);
});

test('new annual scenes have distinct text and respect their era, age and branch gates', () => {
  const g = game();
  const scenes = g.json('expansionAnnualScenes');
  assert.ok(scenes.length >= 30);
  assert.equal(new Set(scenes.map(scene => scene.text)).size, scenes.length);
  const branches = new Set(g.json('branchDefinitions.map(branch=>branch.id)'));
  for (const scene of scenes) {
    assert.ok(typeof scene.text === 'string' && scene.text.length > 12);
    if (scene.branchKey) assert.ok(branches.has(scene.branchKey));
    if (scene.era) {
      assert.ok(['modern', 'awakening', 'cultivation'].includes(scene.era));
      g.run(`state.era=${JSON.stringify(scene.era === 'modern' ? 'cultivation' : 'modern')};`);
      assert.equal(g.run(`expansionAnnualEligible(${JSON.stringify(scene)},${scene.ageMin || 30})`), false);
    }
    if (scene.ageMin !== undefined) assert.equal(g.run(`expansionAnnualEligible(${JSON.stringify(scene)},${scene.ageMin - 1})`), false);
    if (scene.ageMax !== undefined) assert.equal(g.run(`expansionAnnualEligible(${JSON.stringify(scene)},${scene.ageMax + 1})`), false);
  }
  assert.equal(g.calls(), 0);
});

test('a collected story can be revisited next life, with the preference frozen and used only once', () => {
  const g = game({ start: false });
  const before = g.json('metaState.exploration');
  g.run("selectJourneyRevisit('repair_shop');");
  assert.deepEqual(g.json('metaState.exploration'), before, 'a first-time player cannot select an undiscovered story');
  g.run("metaState.lives=1;selectJourneyRevisit('repair_shop');");
  assert.equal(g.run('metaState.exploration.preferredStory'), null, 'completing a life alone does not unlock an unknown story');
  g.run(`metaState.exploration.storyEndings=[{id:'repair_shop:second_bench',storyId:'repair_shop',title:'修不好的那只钟',endingTitle:'第二张凳子',text:'已走过的结局'}];
    selectJourneyRevisit('repair_shop');setAllFive();selectedAbilities=['iron','memory','charmer'];selectedMotiveId='steady_home';startLife();`);
  assert.equal(g.run('state.journeys.preferredId'), 'repair_shop');
  const chosen = g.json('metaState.exploration');
  g.run("selectJourneyRevisit(null);selectJourneyRevisit('river_library');");
  assert.deepEqual(g.json('metaState.exploration'), chosen, 'a running life cannot change the next-life preference');
  g.run("state.age=30;state.majorDone=2;eventPanel.classList.remove('on');result.classList.remove('on');updateJourneyOffer();");
  assert.equal(g.run('state.journeys.active.id'), 'repair_shop');
  for (let chapter = 0; chapter < 3; chapter++) {
    if (chapter) g.run('state.age+=4;state.majorDone++;');
    assert.equal(g.run('chooseJourneyOption(0)'), true);
  }
  g.run('state.age+=4;state.majorDone++;updateJourneyOffer();');
  assert.ok(g.run('state.journeys.active'));
  assert.notEqual(g.run('state.journeys.active.id'), 'repair_shop', 'preference cannot repeat a completed story in the same life');
});

test('revisit preferences cannot bypass disabled worlds or branches', () => {
  const g = game({ start: false });
  g.run(`metaState.lives=1;metaState.exploration.storyEndings=[{id:'algorithm_street:answerable_city',storyId:'algorithm_street',title:'街道推荐给谁',endingTitle:'愿意回答的城市',text:'已走过的结局'}];
    selectJourneyRevisit('algorithm_street');setAllFive();selectedAbilities=['iron','memory','charmer'];selectedMotiveId='steady_home';startLife();
    state.age=30;state.majorDone=2;updateJourneyOffer();`);
  assert.equal(g.run("branchEnabled('future_technology')"), false);
  assert.ok(g.run('state.journeys.active'));
  assert.notEqual(g.run('state.journeys.active.id'), 'algorithm_street');
  assert.equal(g.run('journeyWorldMatches(journeyById(state.journeys.active.id))'), true);
});

