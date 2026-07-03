# 訪問調整アプリ 4枠化＋種別追加 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 1日3枠→4枠（午前①②/午後①②）に変更し、配置に種別（モニタリング/担当者会議/その他）を追加する。

**Architecture:** 単一HTML（`visit-planner.html`）+ localStorage。CORE純関数ブロック（`/* CORE:START */`〜`/* CORE:END */`）をTDDで先に改修し、UI層（描画・ポップオーバー・ハンドラ）を追随させる。データは version 2 に引き上げ、v1データは sanitizeData 内で自動移行。

**Tech Stack:** Vanilla JS (ES5スタイル・var/function)、node:test（CORE抽出テスト）

**設計書:** `docs/superpowers/specs/2026-07-03-visit-planner-4slots-types-design.md`

## Global Constraints

- ファイルは `visit-planner.html` と `tests/core.test.js` のみ変更（他ファイル追加禁止）
- コードはファイル既存のES5スタイル（`var`・`function`・文字列連結）に合わせる
- localStorage キーは `visit-planner-v1` のまま（版管理は `data.version` で行う）
- 種別カラー: monitoring=`#7C3AED`（紫）/ meeting=`#3B50A0`（紺）/ other=`#6B7280`（グレー）
- 既定時刻: slot1=10:00 / slot2=11:00 / slot3=14:00 / slot4=15:30
- 枠ラベル: 午前①/午前②/午後①/午後②
- テストコマンド: `node --test tests/core.test.js`（作業Dir: `C:\Users\kkmh2\claude\訪問調整`）
- 各タスク完了時にコミット（日本語メッセージ・Co-Authored-By: Claude Fable 5 付き）

---

### Task 1: CORE純関数の改修（TDD）＋UI呼び出し箇所の追随

**Files:**
- Modify: `visit-planner.html`（CORE ブロック 157〜283行付近、showToast付近、renderPool、tryPlace、toggleDone）
- Test: `tests/core.test.js`（全面書き換え）

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces（後続タスクが使う名前・シグネチャ）:
  - `SLOT_TIMES = {1:'10:00',2:'11:00',3:'14:00',4:'15:30'}`
  - `SLOT_LABELS = ['午前①','午前②','午後①','午後②']`
  - `TYPES = { monitoring:{label:'モニタ',color:'#7C3AED'}, meeting:{label:'会議',color:'#3B50A0'}, other:{label:'他',color:'#6B7280'} }`
  - `hasMonitoringInMonth(list, userId) -> boolean`（旧 isPlacedInMonth は廃止）
  - `addPlacement(list, userId, date, slot, time, type) -> {ok, list} | {ok:false, reason}`
  - `sanitizeData(raw) -> { data, warned, migratedPooled }`（data.version は 2）
  - `tryPlace(userId, date, slot, type)`（type省略時 'monitoring'）
  - `showInfoToast(msg)`（アンドゥボタンなしトースト・3秒）

- [ ] **Step 1: tests/core.test.js を新仕様に全面書き換え（失敗するテストを書く）**

`tests/core.test.js` 全体を以下で置き換える:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'visit-planner.html'), 'utf8');
const m = src.match(/\/\* CORE:START \*\/([\s\S]*?)\/\* CORE:END \*\//);
if (!m) throw new Error('CORE block not found');
const core = new Function(m[1] + `
  ; return { pad2, makeDateStr, monthKeyOf, daysInMonth, dayOfWeek, isNgDay,
             isSlotFree, hasMonitoringInMonth, countUnplaced, addPlacement, movePlacement,
             copyFromPrevMonth, sanitizeData, SLOT_TIMES, SLOT_LABELS, TYPES };`)();

// 配置オブジェクトの省略記法（新形式・v2）
const P = (o) => Object.assign(
  { userId: 1, date: '2026-07-08', slot: 1, time: '10:00', type: 'monitoring', done: false, gcalEventId: null }, o);

test('makeDateStr/monthKeyOf/pad2', () => {
  assert.strictEqual(core.makeDateStr(2026, 7, 8), '2026-07-08');
  assert.strictEqual(core.monthKeyOf('2026-07-08'), '2026-07');
  assert.strictEqual(core.pad2(3), '03');
});

test('daysInMonth（うるう年含む）', () => {
  assert.strictEqual(core.daysInMonth(2026, 7), 31);
  assert.strictEqual(core.daysInMonth(2026, 2), 28);
  assert.strictEqual(core.daysInMonth(2028, 2), 29);
});

test('dayOfWeek はローカルタイムで曜日を返す', () => {
  assert.strictEqual(core.dayOfWeek('2026-07-02'), 4); // 木曜
  assert.strictEqual(core.dayOfWeek('2026-07-05'), 0); // 日曜
});

test('isNgDay', () => {
  const user = { id: 1, name: '山田', ngDays: [2], memo: '' }; // 火曜NG
  assert.strictEqual(core.isNgDay(user, '2026-07-07'), true);  // 火
  assert.strictEqual(core.isNgDay(user, '2026-07-08'), false); // 水
  assert.strictEqual(core.isNgDay({ id: 2, name: 'x', ngDays: [], memo: '' }, '2026-07-07'), false);
});

test('定数: SLOT_TIMES / SLOT_LABELS / TYPES', () => {
  assert.deepStrictEqual(core.SLOT_TIMES, { 1: '10:00', 2: '11:00', 3: '14:00', 4: '15:30' });
  assert.deepStrictEqual(core.SLOT_LABELS, ['午前①', '午前②', '午後①', '午後②']);
  assert.deepStrictEqual(core.TYPES, {
    monitoring: { label: 'モニタ', color: '#7C3AED' },
    meeting:    { label: '会議',   color: '#3B50A0' },
    other:      { label: '他',     color: '#6B7280' }
  });
});

test('isSlotFree / hasMonitoringInMonth / countUnplaced（モニタ基準）', () => {
  const users = [{ id: 1, name: '山田', ngDays: [], memo: '' }, { id: 2, name: '佐藤', ngDays: [], memo: '' }];
  const meetingOnly = [P({ type: 'meeting' })];
  assert.strictEqual(core.isSlotFree(meetingOnly, '2026-07-08', 1), false); // 枠は種別問わず占有
  assert.strictEqual(core.isSlotFree(meetingOnly, '2026-07-08', 2), true);
  assert.strictEqual(core.hasMonitoringInMonth(meetingOnly, 1), false);     // 会議のみ→モニタ未
  assert.strictEqual(core.countUnplaced(users, meetingOnly), 2);            // 会議はプール消込に影響しない
  const withMon = [P({})];
  assert.strictEqual(core.hasMonitoringInMonth(withMon, 1), true);
  assert.strictEqual(core.countUnplaced(users, withMon), 1);
});

test('addPlacement: モニタ正常追加（typeが保存される）', () => {
  const r = core.addPlacement([], 1, '2026-07-08', 1, '10:00', 'monitoring');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.list[0],
    { userId: 1, date: '2026-07-08', slot: 1, time: '10:00', type: 'monitoring', done: false, gcalEventId: null });
});

test('addPlacement: モニタ2件目は duplicate で拒否', () => {
  const list = [P({})];
  assert.deepStrictEqual(core.addPlacement(list, 1, '2026-07-10', 2, '11:00', 'monitoring'),
    { ok: false, reason: 'duplicate' });
});

test('addPlacement: 会議・その他は同一利用者に月2件以上OK', () => {
  const list = [P({})]; // モニタ済み
  const r1 = core.addPlacement(list, 1, '2026-07-10', 2, '11:00', 'meeting');
  assert.strictEqual(r1.ok, true);
  const r2 = core.addPlacement(r1.list, 1, '2026-07-20', 3, '14:00', 'other');
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.list.length, 3);
});

test('addPlacement: 枠埋まりは種別問わず occupied', () => {
  const list = [P({ type: 'meeting' })];
  assert.deepStrictEqual(core.addPlacement(list, 2, '2026-07-08', 1, '10:00', 'monitoring'),
    { ok: false, reason: 'occupied' });
});

test('movePlacement: 同月内移動で time/type/done を維持・自分自身に引っかからない', () => {
  const list = [P({ type: 'meeting', time: '14:30' })];
  const r = core.movePlacement(list, { date: '2026-07-08', slot: 1 }, { date: '2026-07-08', slot: 2 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.list[0].slot, 2);
  assert.strictEqual(r.list[0].time, '14:30');
  assert.strictEqual(r.list[0].type, 'meeting');
});

test('movePlacement: 埋まった枠への移動と存在しない移動元を拒否', () => {
  const list = [P({}), P({ userId: 2, slot: 2, time: '11:00' })];
  assert.deepStrictEqual(
    core.movePlacement(list, { date: '2026-07-08', slot: 1 }, { date: '2026-07-08', slot: 2 }),
    { ok: false, reason: 'occupied' });
  assert.deepStrictEqual(
    core.movePlacement(list, { date: '2026-07-01', slot: 3 }, { date: '2026-07-02', slot: 1 }),
    { ok: false, reason: 'notfound' });
});

test('copyFromPrevMonth: モニタをコピー・doneリセット・type=monitoring', () => {
  const users = [{ id: 1, name: '山田', ngDays: [], memo: '' }];
  const prev = [P({ time: '13:30', done: true })];
  const r = core.copyFromPrevMonth(prev, [], users, '2026-08');
  assert.strictEqual(r.placements.length, 1);
  assert.deepStrictEqual(r.placements[0],
    { userId: 1, date: '2026-08-08', slot: 1, time: '13:30', type: 'monitoring', done: false, gcalEventId: null });
  assert.deepStrictEqual(r.pooled, []);
});

test('copyFromPrevMonth: 会議・その他はコピーされない（プールにも入らない）', () => {
  const users = [{ id: 1, name: '山田', ngDays: [], memo: '' }];
  const prev = [P({ type: 'meeting' }), P({ slot: 2, time: '11:00', type: 'other' })];
  const r = core.copyFromPrevMonth(prev, [], users, '2026-08');
  assert.strictEqual(r.placements.length, 0);
  assert.deepStrictEqual(r.pooled, []);
});

test('copyFromPrevMonth: 存在しない日はプール行き（1/31→2月）', () => {
  const users = [{ id: 1, name: '山田', ngDays: [], memo: '' }];
  const prev = [P({ date: '2027-01-31' })];
  const r = core.copyFromPrevMonth(prev, [], users, '2027-02');
  assert.strictEqual(r.placements.length, 0);
  assert.deepStrictEqual(r.pooled, [1]);
});

test('copyFromPrevMonth: 予約済み(モニタ)は除外・予約枠との衝突はプール行き', () => {
  const users = [
    { id: 1, name: '山田', ngDays: [], memo: '' },
    { id: 2, name: '佐藤', ngDays: [], memo: '' }
  ];
  const existing = [P({ date: '2026-08-05' })];
  const prev = [
    P({}),                                  // user1 予約済み→除外
    P({ userId: 2, date: '2026-07-05' })    // 8/5 slot1 は予約と衝突→プール
  ];
  const r = core.copyFromPrevMonth(prev, existing, users, '2026-08');
  assert.strictEqual(r.placements.length, 1); // existingのみ
  assert.deepStrictEqual(r.pooled, [2]);
});

test('copyFromPrevMonth: 削除済み利用者の配置は無視', () => {
  const prev = [P({ userId: 99 })];
  const r = core.copyFromPrevMonth(prev, [], [], '2026-08');
  assert.strictEqual(r.placements.length, 0);
  assert.deepStrictEqual(r.pooled, []);
});

test('sanitizeData: null は初期データ（version 2）', () => {
  const r = core.sanitizeData(null);
  assert.deepStrictEqual(r.data, { version: 2, users: [], placements: {}, initializedMonths: [], nextId: 1 });
  assert.strictEqual(r.migratedPooled, 0);
});

test('sanitizeData: v1→v2 移行（slot1→3, 2→4, 3は除外してmigratedPooledに計上）', () => {
  const raw = {
    version: 1,
    users: [
      { id: 1, name: '山田', ngDays: [], memo: '' },
      { id: 2, name: '佐藤', ngDays: [], memo: '' },
      { id: 3, name: '鈴木', ngDays: [], memo: '' }
    ],
    placements: {
      '2026-07': [
        { userId: 1, date: '2026-07-08', slot: 1, time: '13:00', done: false, gcalEventId: null },
        { userId: 2, date: '2026-07-08', slot: 2, time: '14:30', done: true,  gcalEventId: null },
        { userId: 3, date: '2026-07-08', slot: 3, time: '16:00', done: false, gcalEventId: null }
      ]
    },
    initializedMonths: ['2026-07'],
    nextId: 4
  };
  const r = core.sanitizeData(raw);
  assert.strictEqual(r.warned, false);        // 正常な移行は警告なし
  assert.strictEqual(r.migratedPooled, 1);    // 旧③はプールへ
  const list = r.data.placements['2026-07'];
  assert.strictEqual(list.length, 2);
  assert.deepStrictEqual(list[0],
    { userId: 1, date: '2026-07-08', slot: 3, time: '13:00', type: 'monitoring', done: false, gcalEventId: null });
  assert.deepStrictEqual(list[1],
    { userId: 2, date: '2026-07-08', slot: 4, time: '14:30', type: 'monitoring', done: true, gcalEventId: null });
  assert.strictEqual(r.data.version, 2);
});

test('sanitizeData: v2データはそのまま（slot4・type保持）', () => {
  const raw = {
    version: 2,
    users: [{ id: 1, name: '山田', ngDays: [], memo: '' }],
    placements: { '2026-07': [P({ slot: 4, time: '15:30', type: 'meeting' })] },
    initializedMonths: [],
    nextId: 2
  };
  const r = core.sanitizeData(raw);
  assert.strictEqual(r.warned, false);
  assert.strictEqual(r.migratedPooled, 0);
  assert.deepStrictEqual(r.data.placements['2026-07'][0], P({ slot: 4, time: '15:30', type: 'meeting' }));
});

test('sanitizeData: v2でtype欠損・不正は monitoring に修復して警告', () => {
  const raw = {
    version: 2,
    users: [{ id: 1, name: '山田', ngDays: [], memo: '' }],
    placements: { '2026-07': [{ userId: 1, date: '2026-07-08', slot: 1, time: '10:00', type: 'oops', done: false, gcalEventId: null }] },
    initializedMonths: [],
    nextId: 2
  };
  const r = core.sanitizeData(raw);
  assert.strictEqual(r.warned, true);
  assert.strictEqual(r.data.placements['2026-07'][0].type, 'monitoring');
});

test('sanitizeData: 孤児placement除去・月キー不整合はdate側へ移送（v2）', () => {
  const raw = {
    version: 2,
    users: [{ id: 1, name: '山田', ngDays: [2], memo: '' }],
    placements: {
      '2026-07': [
        P({ date: '2026-08-05' }),               // 不整合→2026-08へ
        P({ userId: 9, slot: 2, time: '11:00' }) // 孤児→除去
      ]
    },
    initializedMonths: ['2026-07'],
    nextId: 2
  };
  const r = core.sanitizeData(raw);
  assert.strictEqual(r.warned, true);
  assert.strictEqual((r.data.placements['2026-07'] || []).length, 0);
  assert.strictEqual(r.data.placements['2026-08'].length, 1);
  assert.strictEqual(r.data.placements['2026-08'][0].date, '2026-08-05');
});

test('sanitizeData: モニタ重複は2件目除去・会議重複は保持（v2）', () => {
  const raw = {
    version: 2,
    users: [{ id: 1, name: '山田', ngDays: [], memo: '' }],
    placements: {
      '2026-07': [
        P({}),
        P({ date: '2026-07-10', slot: 2, time: '11:00' }),                   // モニタ2件目→除去
        P({ date: '2026-07-15', slot: 3, time: '14:00', type: 'meeting' }),
        P({ date: '2026-07-20', slot: 3, time: '14:00', type: 'meeting' })   // 会議2件目→保持
      ]
    },
    initializedMonths: [],
    nextId: 2
  };
  const r = core.sanitizeData(raw);
  assert.strictEqual(r.warned, true); // モニタ重複除去で警告
  const list = r.data.placements['2026-07'];
  assert.strictEqual(list.length, 3);
  assert.strictEqual(list.filter(p => p.type === 'monitoring').length, 1);
  assert.strictEqual(list.filter(p => p.type === 'meeting').length, 2);
});

test('sanitizeData: 型不正フィールドはデフォルト補完', () => {
  const raw = { users: [{ id: 1, name: '山田', ngDays: 'x', memo: 5 }], placements: 'bad', nextId: 'x' };
  const r = core.sanitizeData(raw);
  assert.deepStrictEqual(r.data.users[0], { id: 1, name: '山田', ngDays: [], memo: '' });
  assert.deepStrictEqual(r.data.placements, {});
  assert.strictEqual(r.data.nextId, 2); // maxId+1
});
```

- [ ] **Step 2: テスト実行 → 失敗を確認**

Run: `node --test tests/core.test.js`
Expected: FAIL（`hasMonitoringInMonth is not defined` など多数）

- [ ] **Step 3: CORE ブロックを新仕様に書き換え**

`visit-planner.html` の `/* CORE:START */` 〜 `/* CORE:END */` の中身を以下で置き換える
（pad2〜isNgDay・movePlacement は現状のまま。差分のある関数と定数のみ示す。ブロック全体を組み立てること）:

```js
var SLOT_TIMES  = { 1: '10:00', 2: '11:00', 3: '14:00', 4: '15:30' };
var SLOT_LABELS = ['午前①', '午前②', '午後①', '午後②'];
var TYPES = {
  monitoring: { label: 'モニタ', color: '#7C3AED' },
  meeting:    { label: '会議',   color: '#3B50A0' },
  other:      { label: '他',     color: '#6B7280' }
};
```

`isPlacedInMonth` を削除し、代わりに:

```js
function hasMonitoringInMonth(list, userId) {
  return list.some(function (p) { return p.userId === userId && p.type === 'monitoring'; });
}

function countUnplaced(users, list) {
  return users.filter(function (u) { return !hasMonitoringInMonth(list, u.id); }).length;
}
```

```js
function addPlacement(list, userId, date, slot, time, type) {
  if (type === 'monitoring' && hasMonitoringInMonth(list, userId)) return { ok: false, reason: 'duplicate' };
  if (!isSlotFree(list, date, slot)) return { ok: false, reason: 'occupied' };
  return {
    ok: true,
    list: list.concat([{ userId: userId, date: date, slot: slot, time: time, type: type, done: false, gcalEventId: null }])
  };
}
```

```js
function copyFromPrevMonth(prevList, existingList, users, targetMonth) {
  var parts = targetMonth.split('-');
  var maxDay = daysInMonth(Number(parts[0]), Number(parts[1]));
  var placements = existingList.slice();
  var pooled = [];
  prevList.forEach(function (p) {
    if (p.type !== 'monitoring') return;                   // 会議・その他はコピー対象外
    var exists = users.some(function (u) { return u.id === p.userId; });
    if (!exists) return;                                   // 削除済み利用者は無視
    if (hasMonitoringInMonth(placements, p.userId)) return; // 予約済み→コピー対象外
    var day = Number(p.date.slice(8, 10));
    if (day > maxDay) { pooled.push(p.userId); return; }   // 存在しない日→プール
    var date = targetMonth + '-' + pad2(day);
    if (!isSlotFree(placements, date, p.slot)) { pooled.push(p.userId); return; } // 衝突→プール
    placements = placements.concat([{ userId: p.userId, date: date, slot: p.slot, time: p.time, type: 'monitoring', done: false, gcalEventId: null }]);
  });
  return { placements: placements, pooled: pooled };
}
```

```js
function sanitizeData(raw) {
  var data = { version: 2, users: [], placements: {}, initializedMonths: [], nextId: 1 };
  var warned = false;
  var migratedPooled = 0;
  if (!raw || typeof raw !== 'object') return { data: data, warned: raw !== null && raw !== undefined, migratedPooled: 0 };
  var isV1 = raw.version !== 2; // v1 または version欠損は旧形式として移行
  if (Array.isArray(raw.users)) {
    raw.users.forEach(function (u) {
      if (u && typeof u.id === 'number' && typeof u.name === 'string' && u.name !== '') {
        data.users.push({
          id: u.id,
          name: u.name,
          ngDays: Array.isArray(u.ngDays)
            ? u.ngDays.filter(function (n) { return Number.isInteger(n) && n >= 0 && n <= 6; })
            : [],
          memo: typeof u.memo === 'string' ? u.memo : ''
        });
        if (!Array.isArray(u.ngDays) || typeof u.memo !== 'string') warned = true;
      } else { warned = true; }
    });
  } else if (raw.users !== undefined) { warned = true; }
  var ids = {};
  data.users.forEach(function (u) { ids[u.id] = true; });
  if (raw.placements && typeof raw.placements === 'object' && !Array.isArray(raw.placements)) {
    Object.keys(raw.placements).forEach(function (key) {
      var arr = raw.placements[key];
      if (!Array.isArray(arr)) { warned = true; return; }
      arr.forEach(function (p) {
        if (!p || !ids[p.userId] || typeof p.date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) { warned = true; return; }
        var slot = p.slot;
        if (isV1) {
          if (slot === 1) slot = 3;                             // 旧①(13:00)→午後①
          else if (slot === 2) slot = 4;                        // 旧②(14:30)→午後②
          else if (slot === 3) { migratedPooled++; return; }    // 旧③は行き先なし→プールへ
          else { warned = true; return; }
        } else if ([1, 2, 3, 4].indexOf(slot) === -1) { warned = true; return; }
        var type = (p.type === 'monitoring' || p.type === 'meeting' || p.type === 'other') ? p.type : 'monitoring';
        if (!isV1 && type !== p.type) warned = true;            // v2でtype欠損・不正→修復して警告
        var mk = monthKeyOf(p.date);
        if (mk !== key) warned = true; // 不整合→date側を正として移送
        if (!data.placements[mk]) data.placements[mk] = [];
        if ((type === 'monitoring' && hasMonitoringInMonth(data.placements[mk], p.userId)) ||
            !isSlotFree(data.placements[mk], p.date, slot)) { warned = true; return; }
        data.placements[mk].push({
          userId: p.userId, date: p.date, slot: slot,
          time: typeof p.time === 'string' ? p.time : SLOT_TIMES[slot],
          type: type,
          done: p.done === true,
          gcalEventId: typeof p.gcalEventId === 'string' ? p.gcalEventId : null
        });
      });
    });
  } else if (raw.placements !== undefined) { warned = true; }
  if (Array.isArray(raw.initializedMonths)) {
    data.initializedMonths = raw.initializedMonths.filter(function (s) { return typeof s === 'string'; });
  }
  var maxId = 0;
  data.users.forEach(function (u) { if (u.id > maxId) maxId = u.id; });
  data.nextId = (typeof raw.nextId === 'number' && raw.nextId > maxId) ? raw.nextId : maxId + 1;
  if (typeof raw.nextId !== 'number') warned = true;
  return { data: data, warned: warned, migratedPooled: migratedPooled };
}
```

- [ ] **Step 4: UI内の旧名参照を追随修正（3箇所）**

(a) `renderPool` 内:

```js
// 旧
.filter(function (u) { return !isPlacedInMonth(list, u.id); })
// 新
.filter(function (u) { return !hasMonitoringInMonth(list, u.id); })
```

(b) `tryPlace` を丸ごと置き換え（type引数化＋モニタ重複の案内トースト＋枠ラベル）:

```js
function tryPlace(userId, date, slot, type) {
  type = type || 'monitoring';
  var user = userById(userId);
  var mk = monthKeyOf(date);
  var list = appData.placements[mk] || [];
  if (!isSlotFree(list, date, slot)) return;
  if (type === 'monitoring' && hasMonitoringInMonth(list, userId)) {
    showInfoToast('今月のモニタリングは配置済みです。種別を変更してください');
    return;
  }
  confirmNg(user, date, function (ok) {
    if (!ok) { renderAll(); return; }
    snapshotUndo();
    var r = addPlacement(list, userId, date, slot, SLOT_TIMES[slot], type);
    if (!r.ok) { renderAll(); return; }
    appData.placements[mk] = r.list;
    saveData();
    var afterReserve = consumeReserveMode(userId, date);
    renderAll();
    if (!afterReserve) showToast(user.name + 'さんを ' + Number(date.slice(8, 10)) + '日' + SLOT_LABELS[slot - 1] + ' に配置しました');
  });
}
```

(c) `toggleDone` 内:

```js
// 旧
if (isPlacedInMonth(nextList, p.userId)) { // 予約済み→ダイアログなし
// 新
if (hasMonitoringInMonth(nextList, p.userId)) { // 予約済み→ダイアログなし
```

(d) `hideToast` 関数の直後に `showInfoToast` を追加（アンドゥなし・3秒で消える案内用）:

```js
function showInfoToast(msg) {
  var el = document.getElementById('toast');
  el.innerHTML = escapeHtml(msg);
  el.style.display = 'flex';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 3000);
}
```

- [ ] **Step 5: テスト実行 → 全パス確認**

Run: `node --test tests/core.test.js`
Expected: PASS（24テスト全部）

- [ ] **Step 6: コミット**

```powershell
cd "C:\Users\kkmh2\claude\訪問調整"
git add visit-planner.html tests/core.test.js
git commit -m "feat: CORE純関数を4枠・種別対応に改修（v1→v2自動移行含む・TDD 24テスト）"
```

---

### Task 2: 4枠描画・種別チップ・CSS・移行バナー

**Files:**
- Modify: `visit-planner.html`（`:root` CSS変数・`.cal-cell`・`.cal-slot.filled` 付近CSS、`renderCalendar`、`loadData`、`importJson`）

**Interfaces:**
- Consumes: `SLOT_LABELS`・`TYPES`・`sanitizeData().migratedPooled`（Task 1）
- Produces: `.type-chip` / `.cal-slot.filled.type-<key>` のCSSクラス（Task 3・4 のポップオーバーでも同じ色変数 `--type-mon`/`--type-meet`/`--type-other` を使う）

- [ ] **Step 1: CSS変更（4箇所）**

(a) `:root` に種別カラー変数を追加:

```css
/* 旧 */
  --visit: #0C9E8E; --done-bg: #F1F5F9; --ng: #E03F3F; --warn-bg: #FEF3C7;
/* 新 */
  --visit: #0C9E8E; --done-bg: #F1F5F9; --ng: #E03F3F; --warn-bg: #FEF3C7;
  --type-mon: #7C3AED; --type-meet: #3B50A0; --type-other: #6B7280;
```

(b) `.cal-cell` の `min-height: 84px;` → `min-height: 106px;`（4枠分）

(c) `.cal-slot.filled` に左帯を追加:

```css
/* 旧 */
.cal-slot.filled { border-style: solid; border-color: var(--visit); color: var(--text);
  justify-content: space-between; cursor: pointer; }
/* 新 */
.cal-slot.filled { border-style: solid; border-color: var(--visit); color: var(--text);
  border-left-width: 4px; justify-content: space-between; cursor: pointer; }
```

(d) `.cal-slot.filled.done { ... }` の行の直後に追加:

```css
.cal-slot.filled.type-monitoring { border-color: var(--type-mon); }
.cal-slot.filled.type-meeting    { border-color: var(--type-meet); }
.cal-slot.filled.type-other      { border-color: var(--type-other); }
.cal-slot.filled.done { border-color: var(--line); }  /* doneのグレーが種別色に勝つよう順序を維持 */
.type-chip { font-size: 10px; padding: 0 3px; border-radius: 4px; color: #fff;
  margin-right: 3px; flex: none; }
.type-chip.type-monitoring { background: var(--type-mon); }
.type-chip.type-meeting    { background: var(--type-meet); }
.type-chip.type-other      { background: var(--type-other); }
.cal-slot.filled.done .type-chip { background: var(--text-2); opacity: .6; }
```

（注: 既存の `.cal-slot.filled.done` 定義はそのまま残す。上記の `.cal-slot.filled.done { border-color: var(--line); }` は type色の後に来るよう追加して詳細度順を保証する）

- [ ] **Step 2: renderCalendar を4枠＋チップ対応に置き換え**

`renderCalendar` 内の枠ループ部分を置き換え:

```js
    var fill = 0;
    var slots = '';
    for (var s = 1; s <= 4; s++) {
      var p = null;
      for (var j = 0; j < list.length; j++) {
        if (list[j].date === date && list[j].slot === s) { p = list[j]; break; }
      }
      if (p) {
        fill++;
        var u = userById(p.userId);
        var nextBadge = '';
        if (p.done && p.type === 'monitoring') {
          var nmk2 = nextMonthKeyOf(viewYear, viewMonth);
          var np = (appData.placements[nmk2] || []).filter(function (x) { return x.userId === p.userId && x.type === 'monitoring'; })[0];
          if (np) nextBadge = ' <span class="next-badge">📅' + Number(np.date.slice(5, 7)) + '/' + Number(np.date.slice(8, 10)) + '</span>';
        }
        slots += '<div class="cal-slot filled type-' + p.type + (p.done ? ' done' : '') + '" data-date="' + date + '" data-slot="' + s + '">' +
          '<span class="piece-body" data-date="' + date + '" data-slot="' + s + '">' +
          '<span class="type-chip type-' + p.type + '">' + TYPES[p.type].label + '</span>' +
          (isNgDay(u, date) ? '<span class="warn">⚠</span>' : '') +
          escapeHtml(u.name) + nextBadge + '</span>' +
          '<span class="check" data-date="' + date + '" data-slot="' + s + '">' + (p.done ? '✓' : '○') + '</span></div>';
      } else {
        slots += '<div class="cal-slot" data-date="' + date + '" data-slot="' + s + '">' +
          '<span class="slot-label">' + SLOT_LABELS[s - 1] + '</span></div>';
      }
    }
    html += '<div class="cal-cell' + (date === today ? ' today' : '') + '" data-date="' + date + '">' +
      '<div class="day-head"><span class="day-num">' + d + '</span><span class="fill">' + fill + '/4</span></div>' +
      slots + '</div>';
```

- [ ] **Step 3: loadData / importJson に移行バナーを追加**

`loadData` のバナー分岐:

```js
  if (parseFailed) showBanner('⚠ 保存データを読み込めなかったため、初期状態で起動しました');
  else if (r.migratedPooled) showBanner('⚠ 旧データを新しい枠割り（午前2・午後2）に移行しました（' + r.migratedPooled + '件はプールに戻しました）');
  else if (r.warned) showBanner('⚠ 一部のデータが壊れていたため修復しました');
```

`importJson` の warned 分岐:

```js
    if (r.migratedPooled) showBanner('⚠ 旧形式のデータを新しい枠割りに移行しました（' + r.migratedPooled + '件はプールに戻しました）');
    else if (r.warned) showBanner('⚠ インポートデータの一部を修復しました');
```

- [ ] **Step 4: 回帰テスト実行**

Run: `node --test tests/core.test.js`
Expected: PASS（24テスト）

- [ ] **Step 5: ブラウザで目視確認**

`visit-planner.html` をブラウザで開き、(1) 1日に「午前①/午前②/午後①/午後②」の4枠が出る、(2) 日ヘッダが「n/4」、(3) プールから配置すると紫の「モニタ」チップ付きで表示される、を確認。

- [ ] **Step 6: コミット**

```powershell
cd "C:\Users\kkmh2\claude\訪問調整"
git add visit-planner.html
git commit -m "feat: カレンダー4枠表示・種別チップ・v1移行バナーを追加"
```

---

### Task 3: 空き枠クリック → 配置ポップオーバー

**Files:**
- Modify: `visit-planner.html`（CSS `.popover` 付近、`openDetail` の手前に新関数、`init` 内 cal-grid クリックハンドラ）

**Interfaces:**
- Consumes: `SLOT_LABELS`・`TYPES`・`hasMonitoringInMonth`・`ngBadgeText`・`tryPlace(userId,date,slot,type)`・`showInfoToast`・`closePopover`
- Produces: `typeButtonsHtml(selected) -> html文字列`・`bindTypeButtons(container, onChange)`（Task 4 の詳細ポップオーバーが再利用）・`openPlacePopover(date, slot, anchorEl)`

- [ ] **Step 1: CSSに種別ボタンと select のスタイルを追加**

`.popover .rows { ... }` の直後に追加:

```css
.popover select { padding: 4px; border: 1px solid var(--line); border-radius: 6px;
  width: 100%; font-size: 13px; }
.type-btns { display: flex; gap: 4px; }
.type-btn.active[data-type=monitoring] { background: var(--type-mon); border-color: var(--type-mon); color: #fff; }
.type-btn.active[data-type=meeting]    { background: var(--type-meet); border-color: var(--type-meet); color: #fff; }
.type-btn.active[data-type=other]      { background: var(--type-other); border-color: var(--type-other); color: #fff; }
```

- [ ] **Step 2: 共通ヘルパー2つと openPlacePopover を追加**

`/* ===== 詳細ポップオーバー ===== */` コメントの直前に追加:

```js
/* ===== 種別ボタン共通部品 ===== */
function typeButtonsHtml(selected) {
  return Object.keys(TYPES).map(function (k) {
    return '<button class="btn type-btn' + (k === selected ? ' active' : '') + '" data-type="' + k + '">' + TYPES[k].label + '</button>';
  }).join('');
}
function bindTypeButtons(container, onChange) {
  container.querySelectorAll('.type-btn').forEach(function (b) {
    b.onclick = function () {
      container.querySelectorAll('.type-btn').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      onChange(b.dataset.type);
    };
  });
}

/* ===== 空き枠クリック→配置ポップオーバー ===== */
function openPlacePopover(date, slot, anchorEl) {
  closePopover();
  if (!appData.users.length) { showInfoToast('先に利用者管理から登録してください'); return; }
  var list = curList();
  var sorted = appData.users.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
  var selType = 'monitoring';
  var pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'detail-popover';
  pop.innerHTML = '<div class="name">' + Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10)) + ' ' + SLOT_LABELS[slot - 1] + ' に配置</div>' +
    '<div class="rows">' +
    '<div><select id="pp-user">' + sorted.map(function (u) {
      return '<option value="' + u.id + '">' + escapeHtml(u.name) + 'さん' +
        (hasMonitoringInMonth(list, u.id) ? '（モニタ済）' : '') +
        (u.ngDays.length ? ' ' + ngBadgeText(u) : '') + '</option>';
    }).join('') + '</select></div>' +
    '<div class="type-btns" id="pp-types">' + typeButtonsHtml(selType) + '</div>' +
    '<div style="text-align:right"><button class="btn" id="pp-cancel">キャンセル</button> ' +
    '<button class="btn primary" id="pp-place">配置</button></div></div>';
  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
  pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  bindTypeButtons(document.getElementById('pp-types'), function (t) { selType = t; });
  document.getElementById('pp-cancel').onclick = closePopover;
  document.getElementById('pp-place').onclick = function () {
    var uid = Number(document.getElementById('pp-user').value);
    closePopover();
    tryPlace(uid, date, slot, selType);
  };
}
```

- [ ] **Step 3: cal-grid クリックハンドラに空き枠分岐を追加**

`init` 内:

```js
// 旧
    } else if (filled) {
      openDetail(date, slot, slotEl);
    }
// 新
    } else if (filled) {
      openDetail(date, slot, slotEl);
    } else {
      openPlacePopover(date, slot, slotEl);
    }
```

- [ ] **Step 4: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS（24テスト）
ブラウザ: 空き枠クリック→ポップオーバー→利用者選択＋「会議」→配置で紺チップ。モニタ済みの人をモニタで配置→案内トーストが出て配置されない。キャンセルで閉じる。選択モード・予約モード中は従来動作のまま（ポップオーバーが出ない）ことも確認。

- [ ] **Step 5: コミット**

```powershell
cd "C:\Users\kkmh2\claude\訪問調整"
git add visit-planner.html
git commit -m "feat: 空き枠クリックで利用者＋種別を選んで配置できるポップオーバーを追加"
```

---

### Task 4: 詳細ポップオーバーの種別切替＋✓の種別分岐

**Files:**
- Modify: `visit-planner.html`（`openDetail`、`returnToPool`、`toggleDone`）

**Interfaces:**
- Consumes: `typeButtonsHtml`・`bindTypeButtons`（Task 3）・`hasMonitoringInMonth`・`showInfoToast`
- Produces: なし（最終UIタスク）

- [ ] **Step 1: openDetail に種別切替を追加＋ボタン文言変更**

`openDetail` の innerHTML を置き換え:

```js
  pop.innerHTML = '<div class="name">' + escapeHtml(user.name) + 'さん</div>' +
    '<div class="rows">' +
    '<div>時刻: <input type="time" id="dp-time" value="' + escapeHtml(p.time) + '"></div>' +
    '<div class="type-btns" id="dp-types">' + typeButtonsHtml(p.type) + '</div>' +
    (user.memo ? '<div style="color:var(--text-2)">' + escapeHtml(user.memo) + '</div>' : '') +
    '<div><button class="btn" id="dp-move">移動</button> ' +
    '<button class="btn" id="dp-pool">配置を取り消す</button></div>' +
    '<div style="text-align:right"><button class="btn" id="dp-close">閉じる</button></div></div>';
```

`dp-time` の onchange 設定の直後に追加:

```js
  bindTypeButtons(document.getElementById('dp-types'), function (t) {
    if (t === p.type) return;
    if (t === 'monitoring' &&
        hasMonitoringInMonth(curList().filter(function (x) { return x !== p; }), p.userId)) {
      showInfoToast('今月のモニタリングは配置済みのため変更できません');
      var c = document.getElementById('dp-types');
      c.querySelectorAll('.type-btn').forEach(function (x) { x.classList.toggle('active', x.dataset.type === p.type); });
      return;
    }
    var wasMonitoring = p.type === 'monitoring';
    p.type = t;
    saveData();
    renderAll();
    if (wasMonitoring && !hasMonitoringInMonth(curList(), p.userId)) {
      showInfoToast(user.name + 'さんがプールに戻りました（モニタリング未配置）');
    }
  });
```

- [ ] **Step 2: returnToPool のトースト文言を変更**

```js
// 旧
  showToast(user.name + 'さんをプールに戻しました');
// 新
  showToast(user.name + 'さんの配置を取り消しました');
```

- [ ] **Step 3: toggleDone に種別分岐を追加**

`p.done = true;` の直後に挿入:

```js
  if (p.type !== 'monitoring') { saveData(); renderAll(); return; } // 会議・その他は完了のみ（来月予約なし）
```

- [ ] **Step 4: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS（24テスト）
ブラウザ: (1) 配置済みピースクリック→種別3ボタンが出て切替できる・色が変わる、(2) モニタ→会議でプールに再表示＋案内トースト、(3) 会議の✓→ダイアログなしで完了、(4) モニタの✓→従来の3択ダイアログ、(5)「配置を取り消す」で配置削除＋アンドゥ可。

- [ ] **Step 5: コミット**

```powershell
cd "C:\Users\kkmh2\claude\訪問調整"
git add visit-planner.html
git commit -m "feat: 詳細ポップオーバーに種別切替を追加・✓の来月予約はモニタのみに"
```

---

### Task 5: 総合動作確認＋ドキュメント更新

**Files:**
- Modify: `CLAUDE.md`（プロジェクト直下）、`.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: Task 1〜4 の全成果物
- Produces: なし

- [ ] **Step 1: 設計書 §7 受け入れ確認（9項目）をブラウザ実表示で実施**

ローカルHTTPサーバー経由（`npx serve` か node ワンライナー）で開き、以下を確認して記録:

1. 1日に4枠（午前①〜午後②）表示・既定時刻 10:00/11:00/14:00/15:30
2. プールから配置→紫「モニタ」チップ・プールから消える
3. 空き枠クリック→同じ利用者を「会議」で配置できる（紺チップ・プール影響なし）
4. 同じ利用者のモニタ2件目はトーストで拒否
5. 詳細ポップオーバーで種別変更→色が変わる・モニタ→会議でプール再表示
6. モニタ✓→来月予約フロー動作・会議✓はダイアログなし
7. v1形式JSONのインポート→午後枠に移行・旧③はプールへ（バナー通知）
8. 時刻の手入力変更が全4枠で可能
9. スマホ幅（390px）で4枠が縦に収まり操作できる

（ブラウザ自動化が不安定な場合は、実UI操作＋Nodeスタブ検証の併用で代替してよい。ただし目視確認は必須）

- [ ] **Step 2: 進捗記録の更新**

`.superpowers/sdd/progress.md` に本改修のタスク完了記録を追記。`CLAUDE.md` の「実装進捗」「次にやること」を更新（4枠化＋種別対応済み・公開は引き続きオーナー指示待ち）。

- [ ] **Step 3: コミット**

```powershell
cd "C:\Users\kkmh2\claude\訪問調整"
git add CLAUDE.md .superpowers/sdd/progress.md
git commit -m "docs: 4枠化＋種別改修の完了を記録（受け入れ9項目PASS）"
```

---

## Self-Review

- **Spec coverage:** §2データ構造→Task 1／§3純関数→Task 1／§4.1描画→Task 2／§4.2配置ポップオーバー→Task 3／§4.3プール→Task 1(renderPool)／§4.4詳細ポップオーバー→Task 4／§4.5✓分岐→Task 4／§4.6トースト文言→Task 1／§2.3移行＋バナー→Task 1・2／§6テスト→Task 1／§7受け入れ→Task 5。ギャップなし
- **Placeholder scan:** TBD/TODO/「適宜」なし。全ステップに実コードあり
- **Type consistency:** `hasMonitoringInMonth`・`tryPlace(userId,date,slot,type)`・`typeButtonsHtml`/`bindTypeButtons`・`showInfoToast`・`migratedPooled` の名前はタスク間で一致
