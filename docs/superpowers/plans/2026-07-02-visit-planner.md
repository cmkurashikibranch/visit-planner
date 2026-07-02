# 訪問調整アプリ（visit-planner.html）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ケアマネの月間訪問調整を「名前ピースを月間カレンダーにはめ込む」操作で見える化する単一HTMLアプリを作る。

**Architecture:** 単一HTML＋localStorage（キー `visit-planner-v1`）。ロジックは `/* CORE:START */…/* CORE:END */` の純関数ブロックに分離し、Node の `node --test` でTDD。UI層はプレーンJS（`<script type="module">` 不使用）。D&DはPC専用、クリック配置はPC/スマホ共通。

**Tech Stack:** HTML/CSS/Vanilla JS、HTML5 Drag and Drop API、Node組み込みテストランナー（node --test）

**設計書:** `docs/superpowers/specs/2026-07-02-visit-planner-design.md`（v3）— 各タスクの仕様根拠。実装者は必ず一読すること。

## Global Constraints

- 単一HTMLファイル・外部依存なし（CDN・フォント読み込みも不可。オフライン動作）
- 日付処理はローカルタイム固定。`toISOString()`・`new Date("YYYY-MM-DD")` 禁止。曜日は `new Date(y, m-1, d).getDay()`
- 日付文字列は `YYYY-MM-DD`、月キーは `YYYY-MM`。**不変条件：placement は必ず `date.slice(0,7)` と一致する月キーに格納**
- 配置追加は全経路で `addPlacement`、移動は `movePlacement`（移動元除外判定）を通す
- localStorage アクセスは必ず try/catch ラッパー（`lsGet`/`lsSet`）経由
- CORE ブロック内は自己完結（DOM・localStorage・外部変数に依存しない。引数はプレーンデータのみ）
- ファイル編集は Write/Edit ツールのみ（PowerShell経由で書かない・UTF-8）
- コミットは 1 タスク 1〜2 コミット。メッセージは `feat:`/`fix:`/`test:` プレフィックス
- テスト実行は作業Dir＝`C:\Users\kkmh2\claude\訪問調整` で `node --test tests/core.test.js`（ディレクトリ指定は環境によりMODULE_NOT_FOUNDになるためファイル直接指定）

## ファイル構成

| ファイル | 責務 |
|---------|------|
| `visit-planner.html` | アプリ本体（CSS・CORE純関数・UI層すべて） |
| `tests/core.test.js` | CORE純関数の単体テスト（正規表現でCOREブロックを抽出し `new Function` で実行） |

---

### Task 1: HTML骨格＋CORE純関数（判定系）＋テスト土台

**Files:**
- Create: `visit-planner.html`
- Create: `tests/core.test.js`

**Interfaces:**
- Produces（後続タスクが使う正確なシグネチャ）:
  - `pad2(n)` → `"05"` 形式の2桁文字列
  - `makeDateStr(y, m, d)` → `"YYYY-MM-DD"`（m は 1〜12）
  - `monthKeyOf(dateStr)` → `"YYYY-MM"`
  - `daysInMonth(y, m)` → その月の日数（m は 1〜12）
  - `dayOfWeek(dateStr)` → 0(日)〜6(土)
  - `isNgDay(user, dateStr)` → boolean（user.ngDays に曜日が含まれるか）
  - `isSlotFree(list, dateStr, slot)` → boolean
  - `isPlacedInMonth(list, userId)` → boolean
  - `countUnplaced(users, list)` → number
  - `SLOT_TIMES` = `{ 1:'13:00', 2:'14:30', 3:'16:00' }`

- [ ] **Step 1: 失敗するテストを書く**

`tests/core.test.js` を作成：

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
             isSlotFree, isPlacedInMonth, countUnplaced, SLOT_TIMES };`)();

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

test('isSlotFree / isPlacedInMonth / countUnplaced', () => {
  const list = [{ userId: 1, date: '2026-07-08', slot: 1, time: '13:00', done: false, gcalEventId: null }];
  const users = [{ id: 1, name: '山田', ngDays: [], memo: '' }, { id: 2, name: '佐藤', ngDays: [], memo: '' }];
  assert.strictEqual(core.isSlotFree(list, '2026-07-08', 1), false);
  assert.strictEqual(core.isSlotFree(list, '2026-07-08', 2), true);
  assert.strictEqual(core.isPlacedInMonth(list, 1), true);
  assert.strictEqual(core.isPlacedInMonth(list, 2), false);
  assert.strictEqual(core.countUnplaced(users, list), 1);
  assert.strictEqual(core.countUnplaced(users, []), 2);
});

test('SLOT_TIMES 既定時刻', () => {
  assert.deepStrictEqual(core.SLOT_TIMES, { 1: '13:00', 2: '14:30', 3: '16:00' });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/core.test.js`
Expected: FAIL（visit-planner.html が存在しない → ENOENT）

- [ ] **Step 3: 最小実装（HTML骨格＋COREブロック）**

`visit-planner.html` を作成：

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>訪問調整</title>
<style>
/* CSS は Task 3 で追加 */
</style>
</head>
<body>
<div id="app"></div>
<script>
'use strict';
/* CORE:START */
var SLOT_TIMES = { 1: '13:00', 2: '14:30', 3: '16:00' };

function pad2(n) { return String(n).padStart(2, '0'); }

function makeDateStr(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

function monthKeyOf(dateStr) { return dateStr.slice(0, 7); }

function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

function dayOfWeek(dateStr) {
  var p = dateStr.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay();
}

function isNgDay(user, dateStr) {
  return Array.isArray(user.ngDays) && user.ngDays.indexOf(dayOfWeek(dateStr)) !== -1;
}

function isSlotFree(list, dateStr, slot) {
  return !list.some(function (p) { return p.date === dateStr && p.slot === slot; });
}

function isPlacedInMonth(list, userId) {
  return list.some(function (p) { return p.userId === userId; });
}

function countUnplaced(users, list) {
  return users.filter(function (u) { return !isPlacedInMonth(list, u.id); }).length;
}
/* CORE:END */

/* UI層は Task 3 以降で追加 */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pad2: pad2, makeDateStr: makeDateStr };
}
</script>
</body>
</html>
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/core.test.js`
Expected: PASS（6テスト）

- [ ] **Step 5: コミット**

```bash
git add visit-planner.html tests/core.test.js
git commit -m "feat: HTML骨格とCORE判定系純関数（TDD）"
```

---

### Task 2: CORE純関数（変更系）＋テスト

**Files:**
- Modify: `visit-planner.html`（COREブロック内に追記）
- Modify: `tests/core.test.js`

**Interfaces:**
- Consumes: Task 1 の全関数
- Produces:
  - `addPlacement(list, userId, date, slot, time)` → `{ ok:true, list }` または `{ ok:false, reason:'duplicate'|'occupied' }`。list は元配列を変更せず新配列を返す
  - `movePlacement(list, source, target)` → `{ ok:true, list }` または `{ ok:false, reason:'notfound'|'occupied' }`。source/target は `{ date, slot }`
  - `copyFromPrevMonth(prevList, existingList, users, targetMonth)` → `{ placements, pooled }`。placements＝existingList＋コピー分、pooled＝プール行き userId の配列
  - `sanitizeData(raw)` → `{ data, warned }`。data は `{ version, users, placements, initializedMonths, nextId }` の正規形

- [ ] **Step 1: 失敗するテストを書く**

`tests/core.test.js` の `new Function` 戻り値に `addPlacement, movePlacement, copyFromPrevMonth, sanitizeData` を追加し、テストを追記：

```js
test('addPlacement：正常追加・重複・枠埋まりを拒否', () => {
  const r1 = core.addPlacement([], 1, '2026-07-08', 1, '13:00');
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r1.list.length, 1);
  assert.deepStrictEqual(r1.list[0], { userId: 1, date: '2026-07-08', slot: 1, time: '13:00', done: false, gcalEventId: null });
  const r2 = core.addPlacement(r1.list, 1, '2026-07-10', 2, '14:30'); // 同月2回目
  assert.deepStrictEqual(r2, { ok: false, reason: 'duplicate' });
  const r3 = core.addPlacement(r1.list, 2, '2026-07-08', 1, '13:00'); // 枠埋まり
  assert.deepStrictEqual(r3, { ok: false, reason: 'occupied' });
});

test('movePlacement：同月内移動が自分自身に引っかからない', () => {
  const list = [{ userId: 1, date: '2026-07-08', slot: 1, time: '13:00', done: false, gcalEventId: null }];
  const r = core.movePlacement(list, { date: '2026-07-08', slot: 1 }, { date: '2026-07-08', slot: 2 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.list[0].slot, 2);
  assert.strictEqual(r.list[0].time, '13:00'); // 時刻・doneは維持
});

test('movePlacement：埋まった枠への移動と存在しない移動元を拒否', () => {
  const list = [
    { userId: 1, date: '2026-07-08', slot: 1, time: '13:00', done: false, gcalEventId: null },
    { userId: 2, date: '2026-07-08', slot: 2, time: '14:30', done: false, gcalEventId: null }
  ];
  assert.deepStrictEqual(
    core.movePlacement(list, { date: '2026-07-08', slot: 1 }, { date: '2026-07-08', slot: 2 }),
    { ok: false, reason: 'occupied' });
  assert.deepStrictEqual(
    core.movePlacement(list, { date: '2026-07-01', slot: 3 }, { date: '2026-07-02', slot: 1 }),
    { ok: false, reason: 'notfound' });
});

test('copyFromPrevMonth：基本コピー・doneリセット', () => {
  const users = [{ id: 1, name: '山田', ngDays: [], memo: '' }];
  const prev = [{ userId: 1, date: '2026-07-08', slot: 1, time: '13:30', done: true, gcalEventId: null }];
  const r = core.copyFromPrevMonth(prev, [], users, '2026-08');
  assert.strictEqual(r.placements.length, 1);
  assert.deepStrictEqual(r.placements[0], { userId: 1, date: '2026-08-08', slot: 1, time: '13:30', done: false, gcalEventId: null });
  assert.deepStrictEqual(r.pooled, []);
});

test('copyFromPrevMonth：存在しない日はプール行き（1/31→2月）', () => {
  const users = [{ id: 1, name: '山田', ngDays: [], memo: '' }];
  const prev = [{ userId: 1, date: '2027-01-31', slot: 1, time: '13:00', done: false, gcalEventId: null }];
  const r = core.copyFromPrevMonth(prev, [], users, '2027-02');
  assert.strictEqual(r.placements.length, 0);
  assert.deepStrictEqual(r.pooled, [1]);
});

test('copyFromPrevMonth：予約済み利用者は除外・予約枠との衝突はプール行き', () => {
  const users = [
    { id: 1, name: '山田', ngDays: [], memo: '' },
    { id: 2, name: '佐藤', ngDays: [], memo: '' }
  ];
  const existing = [{ userId: 1, date: '2026-08-05', slot: 1, time: '13:00', done: false, gcalEventId: null }];
  const prev = [
    { userId: 1, date: '2026-07-08', slot: 1, time: '13:00', done: false, gcalEventId: null }, // 予約済み→除外
    { userId: 2, date: '2026-07-05', slot: 1, time: '13:00', done: false, gcalEventId: null }  // 8/5①は予約と衝突→プール
  ];
  const r = core.copyFromPrevMonth(prev, existing, users, '2026-08');
  assert.strictEqual(r.placements.length, 1); // existingのみ
  assert.deepStrictEqual(r.pooled, [2]);
});

test('copyFromPrevMonth：削除済み利用者の配置は無視', () => {
  const prev = [{ userId: 99, date: '2026-07-08', slot: 1, time: '13:00', done: false, gcalEventId: null }];
  const r = core.copyFromPrevMonth(prev, [], [], '2026-08');
  assert.strictEqual(r.placements.length, 0);
  assert.deepStrictEqual(r.pooled, []);
});

test('sanitizeData：null・parse失敗相当は初期データ', () => {
  const r = core.sanitizeData(null);
  assert.deepStrictEqual(r.data, { version: 1, users: [], placements: {}, initializedMonths: [], nextId: 1 });
});

test('sanitizeData：孤児placement除去・月キー不整合はdate側へ移送', () => {
  const raw = {
    version: 1,
    users: [{ id: 1, name: '山田', ngDays: [2], memo: '' }],
    placements: {
      '2026-07': [
        { userId: 1, date: '2026-08-05', slot: 1, time: '13:00', done: false, gcalEventId: null }, // 不整合→2026-08へ
        { userId: 9, date: '2026-07-08', slot: 2, time: '14:30', done: false, gcalEventId: null }  // 孤児→除去
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

test('sanitizeData：型不正フィールドはデフォルト補完', () => {
  const raw = { users: [{ id: 1, name: '山田', ngDays: 'x', memo: 5 }], placements: 'bad', nextId: 'x' };
  const r = core.sanitizeData(raw);
  assert.deepStrictEqual(r.data.users[0], { id: 1, name: '山田', ngDays: [], memo: '' });
  assert.deepStrictEqual(r.data.placements, {});
  assert.strictEqual(r.data.nextId, 2); // maxId+1
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `node --test tests/core.test.js`
Expected: FAIL（addPlacement is not defined）

- [ ] **Step 3: 実装（COREブロック内・`/* CORE:END */` の直前に追記）**

```js
function addPlacement(list, userId, date, slot, time) {
  if (isPlacedInMonth(list, userId)) return { ok: false, reason: 'duplicate' };
  if (!isSlotFree(list, date, slot)) return { ok: false, reason: 'occupied' };
  return {
    ok: true,
    list: list.concat([{ userId: userId, date: date, slot: slot, time: time, done: false, gcalEventId: null }])
  };
}

function movePlacement(list, source, target) {
  var idx = -1;
  for (var i = 0; i < list.length; i++) {
    if (list[i].date === source.date && list[i].slot === source.slot) { idx = i; break; }
  }
  if (idx === -1) return { ok: false, reason: 'notfound' };
  var rest = list.filter(function (_, i) { return i !== idx; });
  if (!isSlotFree(rest, target.date, target.slot)) return { ok: false, reason: 'occupied' };
  var moved = {};
  for (var k in list[idx]) moved[k] = list[idx][k];
  moved.date = target.date;
  moved.slot = target.slot;
  return { ok: true, list: rest.concat([moved]) };
}

function copyFromPrevMonth(prevList, existingList, users, targetMonth) {
  var parts = targetMonth.split('-');
  var maxDay = daysInMonth(Number(parts[0]), Number(parts[1]));
  var placements = existingList.slice();
  var pooled = [];
  prevList.forEach(function (p) {
    var exists = users.some(function (u) { return u.id === p.userId; });
    if (!exists) return;                                   // 削除済み利用者は無視
    if (isPlacedInMonth(placements, p.userId)) return;     // 予約済み→コピー対象外
    var day = Number(p.date.slice(8, 10));
    if (day > maxDay) { pooled.push(p.userId); return; }   // 存在しない日→プール
    var date = targetMonth + '-' + pad2(day);
    if (!isSlotFree(placements, date, p.slot)) { pooled.push(p.userId); return; } // 衝突→プール
    placements = placements.concat([{ userId: p.userId, date: date, slot: p.slot, time: p.time, done: false, gcalEventId: null }]);
  });
  return { placements: placements, pooled: pooled };
}

function sanitizeData(raw) {
  var data = { version: 1, users: [], placements: {}, initializedMonths: [], nextId: 1 };
  var warned = false;
  if (!raw || typeof raw !== 'object') return { data: data, warned: raw !== null && raw !== undefined };
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
            !/^\d{4}-\d{2}-\d{2}$/.test(p.date) || [1, 2, 3].indexOf(p.slot) === -1) {
          warned = true; return;
        }
        var mk = monthKeyOf(p.date);
        if (mk !== key) warned = true; // 不整合→date側を正として移送
        if (!data.placements[mk]) data.placements[mk] = [];
        if (isPlacedInMonth(data.placements[mk], p.userId) ||
            !isSlotFree(data.placements[mk], p.date, p.slot)) { warned = true; return; }
        data.placements[mk].push({
          userId: p.userId, date: p.date, slot: p.slot,
          time: typeof p.time === 'string' ? p.time : SLOT_TIMES[p.slot],
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
  return { data: data, warned: warned };
}
```

注意：`sanitizeData(null)` は `warned: false`（初回起動は正常系）。テストの期待値と突き合わせること。

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/core.test.js`
Expected: PASS（16テスト）

- [ ] **Step 5: コミット**

```bash
git add visit-planner.html tests/core.test.js
git commit -m "feat: CORE変更系純関数（addPlacement/movePlacement/copyFromPrevMonth/sanitizeData）"
```

---

### Task 3: 画面骨格・CSS・ストレージ層・表示（renderAll）

**Files:**
- Modify: `visit-planner.html`

**Interfaces:**
- Consumes: CORE全関数
- Produces（後続タスクが使うグローバル）:
  - `var appData` — sanitize済みデータ
  - `var viewYear, viewMonth` — 表示中の年月（month は 1〜12）
  - `curMonthKey()` → 表示中の月キー、`curList()` → 表示中の月の placements 配列（無ければ `[]`）
  - `saveData()` — appData を localStorage へ保存（失敗時 `showBanner('⚠ 保存に失敗しました…')`）
  - `renderAll()` — 全再描画（先頭に `if (dndState) return;` ガード）
  - `showBanner(msg)` — 画面上部の警告バナー表示
  - `openMonth(y, m)` — 表示月の切替（Task 8 で月替わりダイアログを差し込むフック）
  - `userById(id)` → user または undefined
  - DOM構造：`#pool-list`（プール）、`.cal-slot[data-date][data-slot]`（各枠）、`.piece[data-user-id]`（ピース）

- [ ] **Step 1: CSS を追加**

`<style>` 内へ。デザイントークンはお客様ノートと同系（ライト・クリーン）：

```css
:root {
  --bg: #F8FAFC; --card: #FFFFFF; --accent: #2563EB;
  --text: #0F172A; --text-2: #64748B; --line: #E2E8F0;
  --visit: #0C9E8E; --done-bg: #F1F5F9; --ng: #E03F3F; --warn-bg: #FEF3C7;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", Meiryo, sans-serif; font-size: 14px; }
header { display: flex; align-items: center; gap: 12px; padding: 8px 12px;
  background: var(--card); border-bottom: 1px solid var(--line);
  position: sticky; top: 0; z-index: 10; }
header .month-nav { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 16px; }
header button { cursor: pointer; border: 1px solid var(--line); background: var(--card);
  border-radius: 8px; padding: 4px 10px; font-size: 14px; }
#counter { color: var(--text-2); }
#counter .num { color: var(--accent); font-weight: 700; }
#banner { display: none; padding: 6px 12px; background: var(--warn-bg); font-size: 13px; }
main { display: grid; grid-template-columns: 200px 1fr; gap: 10px;
  padding: 10px; height: calc(100vh - 49px); }
/* プール */
#pool { background: var(--card); border: 1px solid var(--line); border-radius: 12px;
  padding: 8px; display: flex; flex-direction: column; min-height: 0; }
#pool h2 { font-size: 13px; color: var(--text-2); margin-bottom: 6px; }
#pool-search { width: 100%; padding: 5px 8px; border: 1px solid var(--line);
  border-radius: 8px; margin-bottom: 6px; font-size: 13px; }
#pool-list { overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 4px; }
.piece { background: var(--card); border: 1px solid var(--visit); border-left: 4px solid var(--visit);
  border-radius: 8px; padding: 4px 6px; cursor: pointer; font-size: 13px; user-select: none; }
.piece .ng-badge { color: var(--ng); font-size: 11px; margin-left: 4px; }
.piece.selected { outline: 2px solid var(--accent); }
/* カレンダー */
#calendar { overflow-y: auto; min-height: 0; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.cal-dow { text-align: center; font-size: 11px; color: var(--text-2); padding: 2px 0; }
.cal-cell { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  padding: 2px; min-height: 84px; }
.cal-cell.other-month { background: transparent; border: none; }
.cal-cell .day-head { display: flex; justify-content: space-between; font-size: 11px;
  color: var(--text-2); padding: 0 2px; }
.cal-cell .day-head .fill { color: var(--accent); }
.cal-cell.today .day-num { color: var(--accent); font-weight: 700; }
.cal-slot { border: 1px dashed var(--line); border-radius: 6px; margin-top: 2px;
  min-height: 22px; font-size: 12px; display: flex; align-items: center;
  padding: 1px 4px; color: var(--text-2); }
.cal-slot .slot-label { opacity: .45; font-size: 11px; }
.cal-slot.filled { border-style: solid; border-color: var(--visit); color: var(--text);
  justify-content: space-between; cursor: pointer; }
.cal-slot.filled.done { background: var(--done-bg); color: var(--text-2); border-color: var(--line); }
.cal-slot .check { min-width: 24px; text-align: center; cursor: pointer; border-radius: 4px; }
.cal-slot .check:hover { background: var(--done-bg); }
.cal-slot .warn { color: var(--ng); }
.cal-slot .next-badge { font-size: 10px; color: var(--text-2); }
.cal-slot.drop-ok { outline: 2px solid var(--accent); background: #EFF6FF; }
.cal-cell.ng-col { background: #FEF2F2; }
```

- [ ] **Step 2: HTML本体を追加**

`<div id="app"></div>` を置き換え：

```html
<header>
  <div class="month-nav">
    <button id="prev-month">◀</button>
    <span id="month-title">2026年7月</span>
    <button id="next-month">▶</button>
  </div>
  <div id="counter">未配置: <span class="num" id="unplaced-n">0</span>名 / 全体 <span id="total-n">0</span>名</div>
  <div style="flex:1"></div>
  <button id="open-users">👥 利用者管理</button>
</header>
<div id="banner"></div>
<div id="mode-banner" style="display:none"></div>
<main>
  <aside id="pool">
    <h2>未配置プール</h2>
    <input id="pool-search" type="text" placeholder="🔍 名前で検索">
    <div id="pool-list"></div>
  </aside>
  <section id="calendar">
    <div class="cal-grid" id="cal-grid"></div>
  </section>
</main>
<div id="toast" style="display:none"></div>
```

- [ ] **Step 3: ストレージ層＋描画のJSを追加（COREブロックの後）**

```js
/* ===== ストレージ ===== */
var LS_KEY = 'visit-planner-v1';
function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function lsSet(key, val) { try { localStorage.setItem(key, val); return true; } catch (e) { return false; } }

var appData = null;
var viewYear = 0, viewMonth = 0; // month: 1-12
var dndState = null;   // Task 6
var selectMode = null; // Task 5 { userId, source }
var reserveMode = null; // Task 7 { userId, returnYear, returnMonth }

function loadData() {
  var rawStr = lsGet(LS_KEY);
  var raw = null;
  var parseFailed = false;
  if (rawStr !== null) {
    try { raw = JSON.parse(rawStr); } catch (e) { parseFailed = true; }
  }
  var r = sanitizeData(raw);
  appData = r.data;
  if (parseFailed) showBanner('⚠ 保存データを読み込めなかったため、初期状態で起動しました');
  else if (r.warned) showBanner('⚠ 一部のデータが壊れていたため修復しました');
}

function saveData() {
  if (!lsSet(LS_KEY, JSON.stringify(appData))) {
    showBanner('⚠ 保存に失敗しました（容量超過の可能性）。JSONエクスポートでバックアップしてください');
  }
}

function showBanner(msg) {
  var el = document.getElementById('banner');
  el.textContent = msg;
  el.style.display = 'block';
}

/* ===== ヘルパー ===== */
function curMonthKey() { return viewYear + '-' + pad2(viewMonth); }
function curList() { return appData.placements[curMonthKey()] || []; }
function setCurList(list) { appData.placements[curMonthKey()] = list; }
function userById(id) {
  for (var i = 0; i < appData.users.length; i++) if (appData.users[i].id === id) return appData.users[i];
  return undefined;
}
function todayStr() {
  var t = new Date();
  return makeDateStr(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
var DOW_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
function ngBadgeText(user) {
  if (!user.ngDays.length) return '';
  return '⚠' + user.ngDays.map(function (d) { return DOW_LABELS[d]; }).join('') + 'NG';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ===== 描画 ===== */
function renderAll() {
  if (dndState) return; // D&D中の再描画ガード
  renderHeader();
  renderPool();
  renderCalendar();
}

function renderHeader() {
  document.getElementById('month-title').textContent = viewYear + '年' + viewMonth + '月';
  document.getElementById('unplaced-n').textContent = countUnplaced(appData.users, curList());
  document.getElementById('total-n').textContent = appData.users.length;
}

function renderPool() {
  var listEl = document.getElementById('pool-list');
  var q = document.getElementById('pool-search').value.trim();
  var list = curList();
  var unplaced = appData.users
    .filter(function (u) { return !isPlacedInMonth(list, u.id); })
    .filter(function (u) { return !q || u.name.indexOf(q) !== -1; })
    .sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
  if (!appData.users.length) {
    listEl.innerHTML = '<div style="color:var(--text-2);font-size:12px;padding:8px">👥 利用者管理から登録してください</div>';
    return;
  }
  listEl.innerHTML = unplaced.map(function (u) {
    return '<div class="piece" data-user-id="' + u.id + '">' + escapeHtml(u.name) + 'さん' +
      (u.ngDays.length ? '<span class="ng-badge">' + ngBadgeText(u) + '</span>' : '') + '</div>';
  }).join('');
}

function renderCalendar() {
  var grid = document.getElementById('cal-grid');
  var list = curList();
  var today = todayStr();
  var first = new Date(viewYear, viewMonth - 1, 1).getDay(); // 月初の曜日
  var days = daysInMonth(viewYear, viewMonth);
  var html = DOW_LABELS.map(function (l) { return '<div class="cal-dow">' + l + '</div>'; }).join('');
  for (var i = 0; i < first; i++) html += '<div class="cal-cell other-month"></div>';
  for (var d = 1; d <= days; d++) {
    var date = makeDateStr(viewYear, viewMonth, d);
    var fill = 0;
    var slots = '';
    for (var s = 1; s <= 3; s++) {
      var p = null;
      for (var j = 0; j < list.length; j++) {
        if (list[j].date === date && list[j].slot === s) { p = list[j]; break; }
      }
      if (p) {
        fill++;
        var u = userById(p.userId);
        var nextBadge = ''; // Task 7 で来月予約バッジを差し込む
        slots += '<div class="cal-slot filled' + (p.done ? ' done' : '') + '" data-date="' + date + '" data-slot="' + s + '">' +
          '<span class="piece-body" data-date="' + date + '" data-slot="' + s + '">' +
          (isNgDay(u, date) ? '<span class="warn">⚠</span>' : '') +
          escapeHtml(u.name) + nextBadge + '</span>' +
          '<span class="check" data-date="' + date + '" data-slot="' + s + '">' + (p.done ? '✓' : '○') + '</span></div>';
      } else {
        slots += '<div class="cal-slot" data-date="' + date + '" data-slot="' + s + '">' +
          '<span class="slot-label">' + ['①', '②', '③'][s - 1] + '</span></div>';
      }
    }
    html += '<div class="cal-cell' + (date === today ? ' today' : '') + '" data-date="' + date + '">' +
      '<div class="day-head"><span class="day-num">' + d + '</span><span class="fill">' + fill + '/3</span></div>' +
      slots + '</div>';
  }
  grid.innerHTML = html;
}

/* ===== 月ナビ ===== */
function openMonth(y, m) {
  if (m < 1) { y--; m = 12; }
  if (m > 12) { y++; m = 1; }
  viewYear = y; viewMonth = m;
  // Task 8: ここに月替わりダイアログの判定を差し込む
  renderAll();
}

/* ===== 初期化 ===== */
function init() {
  loadData();
  var t = new Date();
  viewYear = t.getFullYear(); viewMonth = t.getMonth() + 1;
  document.getElementById('prev-month').onclick = function () { openMonth(viewYear, viewMonth - 1); };
  document.getElementById('next-month').onclick = function () { openMonth(viewYear, viewMonth + 1); };
  document.getElementById('pool-search').oninput = function () { renderPool(); };
  renderAll();
}
init();
```

- [ ] **Step 4: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS（COREを壊していないこと）

ブラウザ確認（`python -m http.server` が使えない環境のため、`Start-Process visit-planner.html` で直接開くか、確認できる範囲で）：
- DevTools コンソールで `localStorage.setItem('visit-planner-v1', JSON.stringify({version:1,users:[{id:1,name:'山田',ngDays:[2],memo:''},{id:2,name:'佐藤',ngDays:[],memo:''}],placements:{},initializedMonths:[],nextId:3}))` を投入してリロード
- プールに「山田さん ⚠火NG」「佐藤さん」が五十音順で出る／カウンター「未配置: 2名 / 全体 2名」／7列カレンダーに各日①②③の空枠と「0/3」が出る／月ナビで移動できる／検索でプールが絞れること

- [ ] **Step 5: コミット**

```bash
git add visit-planner.html
git commit -m "feat: 画面骨格・ストレージ層・プールとカレンダーの描画"
```

---

### Task 4: 利用者管理モーダル（CRUD）＋JSONエクスポート/インポート

**Files:**
- Modify: `visit-planner.html`

**Interfaces:**
- Consumes: `appData`, `saveData()`, `renderAll()`, `sanitizeData`, `escapeHtml`, `DOW_LABELS`
- Produces:
  - `openUsersModal()` / `closeUsersModal()`
  - `#users-modal` のDOM（Task 8 が「今月をリセット」ボタンをこのモーダル内に追加する）

- [ ] **Step 1: モーダルのCSSとHTMLを追加**

CSS（`<style>` 末尾）：

```css
.modal-back { position: fixed; inset: 0; background: rgba(15,23,42,.45);
  display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { background: var(--card); border-radius: 14px; padding: 16px;
  width: min(560px, 92vw); max-height: 86vh; overflow-y: auto; }
.modal h2 { font-size: 16px; margin-bottom: 10px; }
.modal .close-row { text-align: right; margin-top: 10px; }
.user-row { display: flex; align-items: center; gap: 6px; padding: 6px 0;
  border-bottom: 1px solid var(--line); font-size: 13px; flex-wrap: wrap; }
.user-row .name { font-weight: 700; min-width: 90px; }
.user-row .meta { color: var(--text-2); flex: 1; }
.user-form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px;
  padding: 10px; background: var(--bg); border-radius: 10px; }
.user-form input[type=text] { padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; }
.ng-checks { display: flex; gap: 8px; font-size: 13px; flex-wrap: wrap; }
.btn { cursor: pointer; border: 1px solid var(--line); background: var(--card);
  border-radius: 8px; padding: 5px 12px; font-size: 13px; }
.btn.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.btn.danger { color: var(--ng); }
```

HTML（`</main>` の直後）：

```html
<div class="modal-back" id="users-modal" style="display:none">
  <div class="modal">
    <h2>👥 利用者管理</h2>
    <div id="users-list"></div>
    <div class="user-form">
      <div id="form-title" style="font-size:13px;color:var(--text-2)">新規登録</div>
      <input type="text" id="uf-name" placeholder="名前（必須）">
      <div class="ng-checks" id="uf-ng"></div>
      <input type="text" id="uf-memo" placeholder="自由メモ（例：午前は通所）">
      <div>
        <button class="btn primary" id="uf-save">保存</button>
        <button class="btn" id="uf-cancel" style="display:none">編集をやめる</button>
      </div>
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" id="users-tools">
      <button class="btn" id="btn-export">⬇ JSONエクスポート</button>
      <button class="btn" id="btn-import">⬆ JSONインポート</button>
      <input type="file" id="import-file" accept=".json,application/json" style="display:none">
    </div>
    <div class="close-row"><button class="btn" id="users-close">閉じる</button></div>
  </div>
</div>
```

- [ ] **Step 2: JSを追加**

```js
/* ===== 利用者管理 ===== */
var editingUserId = null;

function openUsersModal() {
  editingUserId = null;
  renderUsersModal();
  document.getElementById('users-modal').style.display = 'flex';
}
function closeUsersModal() {
  document.getElementById('users-modal').style.display = 'none';
  renderAll();
}

function renderUsersModal() {
  var listEl = document.getElementById('users-list');
  var sorted = appData.users.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });
  listEl.innerHTML = sorted.map(function (u) {
    return '<div class="user-row"><span class="name">' + escapeHtml(u.name) + 'さん</span>' +
      '<span class="meta">' + (u.ngDays.length ? ngBadgeText(u) + ' ' : '') + escapeHtml(u.memo) + '</span>' +
      '<button class="btn" data-edit="' + u.id + '">編集</button>' +
      '<button class="btn danger" data-del="' + u.id + '">削除</button></div>';
  }).join('') || '<div style="color:var(--text-2);font-size:13px">まだ登録がありません</div>';
  var ngEl = document.getElementById('uf-ng');
  var checked = editingUserId !== null ? userById(editingUserId).ngDays : [];
  ngEl.innerHTML = 'NG曜日: ' + DOW_LABELS.map(function (l, i) {
    return '<label><input type="checkbox" value="' + i + '"' +
      (checked.indexOf(i) !== -1 ? ' checked' : '') + '>' + l + '</label>';
  }).join('');
  document.getElementById('form-title').textContent =
    editingUserId === null ? '新規登録' : userById(editingUserId).name + 'さんを編集中';
  document.getElementById('uf-name').value = editingUserId === null ? '' : userById(editingUserId).name;
  document.getElementById('uf-memo').value = editingUserId === null ? '' : userById(editingUserId).memo;
  document.getElementById('uf-cancel').style.display = editingUserId === null ? 'none' : 'inline-block';
}

function saveUserForm() {
  var name = document.getElementById('uf-name').value.trim();
  if (!name) { alert('名前を入力してください'); return; }
  var ngDays = Array.prototype.slice.call(
    document.querySelectorAll('#uf-ng input:checked')).map(function (el) { return Number(el.value); });
  var memo = document.getElementById('uf-memo').value.trim();
  if (editingUserId === null) {
    appData.users.push({ id: appData.nextId++, name: name, ngDays: ngDays, memo: memo });
  } else {
    var u = userById(editingUserId);
    u.name = name; u.ngDays = ngDays; u.memo = memo;
  }
  editingUserId = null;
  saveData();
  renderUsersModal();
}

function deleteUser(id) {
  var u = userById(id);
  if (!confirm(u.name + 'さんを削除しますか？\nすべての月の配置も削除されます')) return;
  appData.users = appData.users.filter(function (x) { return x.id !== id; });
  Object.keys(appData.placements).forEach(function (mk) {
    appData.placements[mk] = appData.placements[mk].filter(function (p) { return p.userId !== id; });
  });
  if (editingUserId === id) editingUserId = null;
  saveData();
  renderUsersModal();
}

/* ===== JSONエクスポート/インポート ===== */
function exportJson() {
  var blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'visit-planner-' + todayStr() + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  var reader = new FileReader();
  reader.onload = function () {
    var raw = null;
    try { raw = JSON.parse(reader.result); }
    catch (e) { alert('JSONファイルを読み取れませんでした'); return; }
    if (!confirm('現在のデータをインポート内容で置き換えます。よろしいですか？')) return;
    var r = sanitizeData(raw);
    appData = r.data;
    if (r.warned) showBanner('⚠ インポートデータの一部を修復しました');
    saveData();
    renderUsersModal();
    renderAll();
  };
  reader.readAsText(file);
}
```

`init()` にイベント登録を追記：

```js
  document.getElementById('open-users').onclick = openUsersModal;
  document.getElementById('users-close').onclick = closeUsersModal;
  document.getElementById('uf-save').onclick = saveUserForm;
  document.getElementById('uf-cancel').onclick = function () { editingUserId = null; renderUsersModal(); };
  document.getElementById('users-list').onclick = function (e) {
    var t = e.target;
    if (t.dataset.edit) { editingUserId = Number(t.dataset.edit); renderUsersModal(); }
    if (t.dataset.del) deleteUser(Number(t.dataset.del));
  };
  document.getElementById('btn-export').onclick = exportJson;
  document.getElementById('btn-import').onclick = function () { document.getElementById('import-file').click(); };
  document.getElementById('import-file').onchange = function (e) {
    if (e.target.files[0]) importJson(e.target.files[0]);
    e.target.value = '';
  };
```

- [ ] **Step 3: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS

ブラウザ確認：登録（NG曜日つき）→プールに反映／編集／削除で配置も消える／エクスポートでファイルDL／インポートで復元／不正JSONでエラーメッセージ。

- [ ] **Step 4: コミット**

```bash
git add visit-planner.html
git commit -m "feat: 利用者管理CRUDとJSONエクスポート・インポート"
```

---

### Task 5: クリック配置・詳細ポップオーバー・アンドゥ

**Files:**
- Modify: `visit-planner.html`

**Interfaces:**
- Consumes: `addPlacement`, `movePlacement`, `isNgDay`, `SLOT_TIMES`, `curList()`, `setCurList()`, `selectMode`
- Produces:
  - `tryPlace(userId, date, slot, listOwnerKey)` — NG確認込みの配置共通経路（クリック配置・D&D・予約モードが使う）
  - `tryMove(source, target)` — NG確認込みの移動共通経路
  - `enterSelectMode(userId, source)` / `exitSelectMode()` — `source` は `'pool'` または `{date,slot}`
  - `openDetail(date, slot)` — 詳細ポップオーバー
  - `snapshotUndo(label)` / トースト `showToast(label)` — 直前1操作のアンドゥ
  - `findPlacement(list, date, slot)` → placement または null

- [ ] **Step 1: CSSを追加**

```css
#mode-banner { padding: 6px 12px; background: #EFF6FF; color: var(--accent);
  font-size: 13px; display: flex; align-items: center; gap: 10px; }
#toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  background: var(--text); color: #fff; border-radius: 10px; padding: 8px 14px;
  font-size: 13px; display: flex; gap: 12px; z-index: 200; }
#toast button { background: none; border: none; color: #93C5FD; cursor: pointer; font-size: 13px; }
.popover { position: absolute; background: var(--card); border: 1px solid var(--line);
  border-radius: 12px; padding: 10px; box-shadow: 0 8px 24px rgba(15,23,42,.15);
  z-index: 150; width: 220px; font-size: 13px; }
.popover .name { font-weight: 700; margin-bottom: 6px; }
.popover input[type=time] { padding: 4px; border: 1px solid var(--line); border-radius: 6px; }
.popover .rows { display: flex; flex-direction: column; gap: 6px; }
```

- [ ] **Step 2: JSを追加**

```js
/* ===== アンドゥ ===== */
var undoSnapshot = null;
var toastTimer = null;

function snapshotUndo() {
  undoSnapshot = JSON.stringify(appData.placements);
}
function showToast(label) {
  var el = document.getElementById('toast');
  el.innerHTML = escapeHtml(label) + '<button id="undo-btn">元に戻す</button>';
  el.style.display = 'flex';
  document.getElementById('undo-btn').onclick = function () {
    if (undoSnapshot) {
      appData.placements = JSON.parse(undoSnapshot);
      undoSnapshot = null;
      saveData();
      renderAll();
    }
    hideToast();
  };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() { document.getElementById('toast').style.display = 'none'; }

/* ===== 配置・移動の共通経路（NG確認込み） ===== */
function findPlacement(list, date, slot) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].date === date && list[i].slot === slot) return list[i];
  }
  return null;
}

function confirmNg(user, date, cb) {
  if (isNgDay(user, date)) {
    var ok = confirm('⚠ ' + DOW_LABELS[dayOfWeek(date)] + '曜NGの方ですが配置しますか？');
    cb(ok);
  } else { cb(true); }
}

function tryPlace(userId, date, slot) {
  var user = userById(userId);
  var mk = monthKeyOf(date);
  var list = appData.placements[mk] || [];
  if (!isSlotFree(list, date, slot) || isPlacedInMonth(list, userId)) return;
  confirmNg(user, date, function (ok) {
    if (!ok) { renderAll(); return; }
    snapshotUndo();
    var r = addPlacement(list, userId, date, slot, SLOT_TIMES[slot]);
    if (!r.ok) { renderAll(); return; }
    appData.placements[mk] = r.list;
    saveData();
    var afterReserve = consumeReserveMode(userId, date); // Task 7 で定義（それまではダミー）
    renderAll();
    if (!afterReserve) showToast(user.name + 'さんを ' + Number(date.slice(8, 10)) + '日' + ['①', '②', '③'][slot - 1] + ' に配置しました');
  });
}

function tryMove(source, target) {
  var list = curList();
  var p = findPlacement(list, source.date, source.slot);
  if (!p) return;
  if (!isSlotFree(list.filter(function (x) { return x !== p; }), target.date, target.slot)) return;
  var user = userById(p.userId);
  confirmNg(user, target.date, function (ok) {
    if (!ok) { renderAll(); return; }
    snapshotUndo();
    var r = movePlacement(list, source, target);
    if (!r.ok) { renderAll(); return; }
    setCurList(r.list);
    saveData();
    renderAll();
    showToast(user.name + 'さんを ' + Number(target.date.slice(8, 10)) + '日に移動しました');
  });
}

function returnToPool(date, slot) {
  var list = curList();
  var p = findPlacement(list, date, slot);
  if (!p) return;
  var user = userById(p.userId);
  snapshotUndo();
  setCurList(list.filter(function (x) { return x !== p; }));
  saveData();
  closePopover();
  renderAll();
  showToast(user.name + 'さんをプールに戻しました');
}

/* Task 7 で本実装。それまで常に false を返すダミー */
function consumeReserveMode(userId, date) { return false; }

/* ===== クリック配置（選択モード） ===== */
function enterSelectMode(userId, source) {
  selectMode = { userId: userId, source: source };
  var user = userById(userId);
  var el = document.getElementById('mode-banner');
  el.innerHTML = (source === 'pool' ? '配置' : '移動') + 'モード：' + escapeHtml(user.name) +
    'さんの枠をクリックしてください <button class="btn" id="select-cancel">キャンセル</button>';
  el.style.display = 'flex';
  document.getElementById('select-cancel').onclick = exitSelectMode;
  renderAll();
  highlightSelected();
}
function exitSelectMode() {
  selectMode = null;
  document.getElementById('mode-banner').style.display = 'none';
  renderAll();
}
function highlightSelected() {
  if (!selectMode) return;
  var el = document.querySelector('#pool-list .piece[data-user-id="' + selectMode.userId + '"]');
  if (el) el.classList.add('selected');
}

/* ===== 詳細ポップオーバー ===== */
function openDetail(date, slot, anchorEl) {
  closePopover();
  var p = findPlacement(curList(), date, slot);
  if (!p) return;
  var user = userById(p.userId);
  var pop = document.createElement('div');
  pop.className = 'popover';
  pop.id = 'detail-popover';
  pop.innerHTML = '<div class="name">' + escapeHtml(user.name) + 'さん</div>' +
    '<div class="rows">' +
    '<div>時刻: <input type="time" id="dp-time" value="' + p.time + '"></div>' +
    (user.memo ? '<div style="color:var(--text-2)">' + escapeHtml(user.memo) + '</div>' : '') +
    '<div><button class="btn" id="dp-move">移動</button> ' +
    '<button class="btn" id="dp-pool">プールに戻す</button></div>' +
    '<div style="text-align:right"><button class="btn" id="dp-close">閉じる</button></div></div>';
  document.body.appendChild(pop);
  var rect = anchorEl.getBoundingClientRect();
  pop.style.left = Math.min(rect.left, window.innerWidth - 240) + 'px';
  pop.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  document.getElementById('dp-time').onchange = function (e) {
    p.time = e.target.value || p.time;
    saveData();
  };
  document.getElementById('dp-move').onclick = function () {
    closePopover();
    enterSelectMode(p.userId, { date: date, slot: slot });
  };
  document.getElementById('dp-pool').onclick = function () { returnToPool(date, slot); };
  document.getElementById('dp-close').onclick = closePopover;
}
function closePopover() {
  var el = document.getElementById('detail-popover');
  if (el) el.remove();
}
```

`init()` にクリック委譲を追記：

```js
  document.getElementById('pool-list').onclick = function (e) {
    var piece = e.target.closest('.piece');
    if (!piece) return;
    var uid = Number(piece.dataset.userId);
    if (selectMode && selectMode.userId === uid) { exitSelectMode(); return; }
    enterSelectMode(uid, 'pool');
  };
  document.getElementById('cal-grid').onclick = function (e) {
    var check = e.target.closest('.check');
    if (check) return; // ✓は Task 7 で処理
    var slotEl = e.target.closest('.cal-slot');
    if (!slotEl) { closePopover(); return; }
    var date = slotEl.dataset.date, slot = Number(slotEl.dataset.slot);
    var filled = slotEl.classList.contains('filled');
    if (selectMode) {
      if (filled) return; // 埋まった枠は受け付けない
      var sm = selectMode;
      exitSelectMode();
      if (sm.source === 'pool') tryPlace(sm.userId, date, slot);
      else tryMove(sm.source, { date: date, slot: slot });
    } else if (filled) {
      openDetail(date, slot, slotEl);
    }
  };
```

- [ ] **Step 3: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS

ブラウザ確認：ピースクリック→バナー→空枠クリックで配置（既定時刻）／NG曜日でconfirm→キャンセルで変更なし／トースト「元に戻す」で復帰／配置済みクリック→ポップオーバー（時刻編集・移動・プール戻し）／移動が同月内で重複エラーにならない／埋まった枠には配置不可。

- [ ] **Step 4: コミット**

```bash
git add visit-planner.html
git commit -m "feat: クリック配置・詳細ポップオーバー・アンドゥトースト"
```

---

### Task 6: D&D（PC専用）＋NG事前ハイライト＋pendingDrop

**Files:**
- Modify: `visit-planner.html`

**Interfaces:**
- Consumes: `tryPlace`, `tryMove`, `dndState`, `isNgDay`, `userById`
- Produces:
  - `isTouchDevice()` → boolean（`matchMedia('(pointer: coarse)')` ＋幅768px未満）
  - `attachDnd()` — renderAll 後に毎回呼ぶ（cal-grid / pool-list に dragover/drop、ピースに dragstart/dragend）
  - `var pieceDragging` — ✓クリック誤発火防止フラグ（Task 7 が参照）

- [ ] **Step 1: JSを追加**

```js
/* ===== D&D（PC専用） ===== */
var pieceDragging = false;
var pendingDrop = null;

function isTouchDevice() {
  return window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 768;
}

function attachDnd() {
  if (isTouchDevice()) return;
  // プールのピース
  document.querySelectorAll('#pool-list .piece').forEach(function (el) {
    el.draggable = true;
    el.addEventListener('dragstart', function (e) {
      dndState = { userId: Number(el.dataset.userId), source: 'pool' };
      pieceDragging = true;
      markNgColumns(dndState.userId);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', onDragEnd);
  });
  // 配置済みピース
  document.querySelectorAll('.cal-slot.filled').forEach(function (el) {
    el.draggable = true;
    el.addEventListener('dragstart', function (e) {
      var p = findPlacement(curList(), el.dataset.date, Number(el.dataset.slot));
      if (!p) return;
      dndState = { userId: p.userId, source: { date: el.dataset.date, slot: Number(el.dataset.slot) } };
      pieceDragging = true;
      markNgColumns(p.userId);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', onDragEnd);
  });
  // ドロップ先：空き枠
  document.querySelectorAll('.cal-slot:not(.filled)').forEach(function (el) {
    el.addEventListener('dragover', function (e) { if (dndState) { e.preventDefault(); el.classList.add('drop-ok'); } });
    el.addEventListener('dragleave', function () { el.classList.remove('drop-ok'); });
    el.addEventListener('drop', function (e) {
      e.preventDefault();
      if (!dndState) return;
      pendingDrop = { state: dndState, date: el.dataset.date, slot: Number(el.dataset.slot), toPool: false };
      resolveDrop();
    });
  });
  // ドロップ先：プール（配置済み→未配置に戻す）
  var pool = document.getElementById('pool');
  pool.addEventListener('dragover', function (e) {
    if (dndState && dndState.source !== 'pool') { e.preventDefault(); pool.style.outline = '2px solid var(--accent)'; }
  });
  pool.addEventListener('dragleave', function () { pool.style.outline = ''; });
  pool.addEventListener('drop', function (e) {
    e.preventDefault();
    pool.style.outline = '';
    if (!dndState || dndState.source === 'pool') return;
    pendingDrop = { state: dndState, toPool: true };
    resolveDrop();
  });
}

function resolveDrop() {
  // pendingDropに退避済み → dndStateリセット＆ハイライト全消去を同期で完了
  var pd = pendingDrop;
  pendingDrop = null;
  dndState = null;
  clearNgColumns();
  document.querySelectorAll('.drop-ok').forEach(function (el) { el.classList.remove('drop-ok'); });
  setTimeout(function () { // NG確認confirmはdropハンドラの外へ逃す
    if (pd.toPool) {
      returnToPool(pd.state.source.date, pd.state.source.slot);
    } else if (pd.state.source === 'pool') {
      tryPlace(pd.state.userId, pd.date, pd.slot);
    } else {
      tryMove(pd.state.source, { date: pd.date, slot: pd.slot });
    }
  }, 0);
}

function onDragEnd() {
  // drop不成立（枠外リリース等）の後始末
  dndState = null;
  clearNgColumns();
  document.querySelectorAll('.drop-ok').forEach(function (el) { el.classList.remove('drop-ok'); });
  document.getElementById('pool').style.outline = '';
  setTimeout(function () { pieceDragging = false; }, 0);
  renderAll();
}

function markNgColumns(userId) {
  var user = userById(userId);
  if (!user || !user.ngDays.length) return;
  document.querySelectorAll('.cal-cell[data-date]').forEach(function (el) {
    if (user.ngDays.indexOf(dayOfWeek(el.dataset.date)) !== -1) el.classList.add('ng-col');
  });
}
function clearNgColumns() {
  document.querySelectorAll('.ng-col').forEach(function (el) { el.classList.remove('ng-col'); });
}
```

`renderAll()` の末尾（renderCalendar の後）に `attachDnd();` を追加。innerHTML再生成でピース・枠のリスナーは毎回消えるため多重登録は起きないが、**pool要素・cal-grid要素そのものへの addEventListener は init() で1回だけ行うよう注意**（上記コードは pool への listener が attachDnd 毎に重複するため、pool の dragover/dragleave/drop の3つは init() へ移すこと）。

- [ ] **Step 2: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS

ブラウザ確認：プール→空枠へD&D配置／ドラッグ開始でNG曜日の列が赤くなる／NG枠ドロップでconfirm→キャンセルなら何も変わらない（pendingDrop破棄）／配置済み→別日へ移動／配置済み→プールへ戻す／枠外リリースで状態が壊れない（onDragEnd後に普通に操作できる）／ドラッグ直後にポップオーバーが誤って開かない。

- [ ] **Step 3: コミット**

```bash
git add visit-planner.html
git commit -m "feat: D&D配置・移動・プール戻し（NG事前ハイライト＋pendingDrop方式）"
```

---

### Task 7: ✓トグル＋来月予約フロー（カスタム3択モーダル・予約モード）

**Files:**
- Modify: `visit-planner.html`

**Interfaces:**
- Consumes: `tryPlace`, `openMonth`, `reserveMode`, `pieceDragging`, `isPlacedInMonth`, `monthKeyOf`
- Produces:
  - `showChoice(text, buttons)` → Promise。`buttons` は `[{label, value, primary}]`
  - `toggleDone(date, slot)` — ✓トグル＋予約フロー
  - `enterReserveMode(userId)` / `consumeReserveMode(userId, date)`（Task 5 のダミーを本実装で置換）
  - `nextMonthKeyOf(y, m)` → 翌月の `'YYYY-MM'`

- [ ] **Step 1: カスタムモーダルのCSS/HTML/JSを追加**

CSS：

```css
.choice-back { position: fixed; inset: 0; background: rgba(15,23,42,.45);
  display: flex; align-items: center; justify-content: center; z-index: 300; }
.choice { background: var(--card); border-radius: 14px; padding: 18px;
  width: min(340px, 90vw); font-size: 14px; }
.choice .text { margin-bottom: 14px; line-height: 1.6; }
.choice .btns { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
```

JS：

```js
/* ===== カスタム選択モーダル（3択対応・confirm代替） ===== */
function showChoice(text, buttons) {
  return new Promise(function (resolve) {
    var back = document.createElement('div');
    back.className = 'choice-back';
    back.innerHTML = '<div class="choice"><div class="text">' + escapeHtml(text) + '</div>' +
      '<div class="btns">' + buttons.map(function (b, i) {
        return '<button class="btn' + (b.primary ? ' primary' : '') + '" data-i="' + i + '">' + escapeHtml(b.label) + '</button>';
      }).join('') + '</div></div>';
    back.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-i]');
      if (!btn) return;
      back.remove();
      resolve(buttons[Number(btn.dataset.i)].value);
    });
    document.body.appendChild(back);
  });
}
```

- [ ] **Step 2: ✓トグル＋予約モードのJSを追加**

```js
/* ===== 訪問済み✓ → 来月予約 ===== */
function nextMonthKeyOf(y, m) {
  return m === 12 ? (y + 1) + '-01' : y + '-' + pad2(m + 1);
}

function toggleDone(date, slot) {
  if (pieceDragging) return; // ドラッグ直後の誤発火防止
  var p = findPlacement(curList(), date, slot);
  if (!p) return;
  var user = userById(p.userId);
  var nmk = nextMonthKeyOf(viewYear, viewMonth);
  var nextList = appData.placements[nmk] || [];
  if (p.done) {
    p.done = false; // 解除（来月予約は残す。再✓時に予約済みならダイアログなし）
    saveData();
    renderAll();
    return;
  }
  p.done = true;
  if (isPlacedInMonth(nextList, p.userId)) { // 予約済み→ダイアログなし
    saveData();
    renderAll();
    return;
  }
  showChoice(user.name + 'さんを訪問済みにしました。\n来月の予約を入れますか？', [
    { label: 'キャンセル', value: 'cancel' },
    { label: 'いいえ', value: 'no' },
    { label: 'はい', value: 'yes', primary: true }
  ]).then(function (v) {
    if (v === 'cancel') { p.done = false; saveData(); renderAll(); return; } // ✓も取り消す
    if (v === 'no') { saveData(); renderAll(); return; }
    saveData();
    enterReserveMode(p.userId);
  });
}

function enterReserveMode(userId) {
  reserveMode = { userId: userId, returnYear: viewYear, returnMonth: viewMonth };
  var user = userById(userId);
  openMonth(viewYear, viewMonth + 1); // 予約モード中は月替わりダイアログを出さない（openMonth側で判定）
  var el = document.getElementById('mode-banner');
  el.innerHTML = '📅 予約モード：' + escapeHtml(user.name) + 'さんの来月の枠を選んでください ' +
    '<button class="btn" id="reserve-cancel">当月に戻る</button>';
  el.style.display = 'flex';
  document.getElementById('reserve-cancel').onclick = exitReserveMode;
}

function exitReserveMode() {
  var rm = reserveMode;
  reserveMode = null;
  document.getElementById('mode-banner').style.display = 'none';
  if (rm) openMonth(rm.returnYear, rm.returnMonth);
}

/* Task 5 のダミーを置き換え：予約モード中の配置成立→自動で当月へ戻る */
function consumeReserveMode(userId, date) {
  if (reserveMode && reserveMode.userId === userId) {
    var user = userById(userId);
    exitReserveMode();
    showToast(user.name + 'さんの来月予約を入れました（' + Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10)) + '）');
    return true;
  }
  return false;
}
```

予約モード中のクリック配置が動くように、cal-grid のクリックハンドラ（Task 5）の `selectMode` 分岐の**前**に追記：

```js
    if (reserveMode && !filled) {
      tryPlace(reserveMode.userId, date, slot);
      return;
    }
```

✓のクリックを cal-grid ハンドラの先頭で処理（Task 5 の `if (check) return;` を置換）：

```js
    var check = e.target.closest('.check');
    if (check) { toggleDone(check.dataset.date, Number(check.dataset.slot)); return; }
```

renderCalendar の `nextBadge` を本実装（Task 3 の `var nextBadge = '';` を置換）：

```js
        var nextBadge = '';
        if (p.done) {
          var nmk2 = nextMonthKeyOf(viewYear, viewMonth);
          var np = (appData.placements[nmk2] || []).filter(function (x) { return x.userId === p.userId; })[0];
          if (np) nextBadge = ' <span class="next-badge">📅' + Number(np.date.slice(5, 7)) + '/' + Number(np.date.slice(8, 10)) + '</span>';
        }
```

また `tryPlace` 内の重複チェックは予約モードでも効くため、予約対象月にすでに配置済みなら何も起きない（enterReserveMode 前に isPlacedInMonth 判定済みなので通常到達しない）。

- [ ] **Step 3: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS

ブラウザ確認：✓クリック→3択モーダル／キャンセル→✓が戻る／いいえ→✓のみ／はい→来月表示＋バナー→空枠クリックで配置→自動で当月に戻りトースト表示／✓済みピースに📅バッジ／✓解除→再✓（予約済み）でダイアログが出ない／D&D直後に✓が誤発火しない。

- [ ] **Step 4: コミット**

```bash
git add visit-planner.html
git commit -m "feat: 訪問済みチェックと来月予約フロー（3択モーダル・予約モード）"
```

---

### Task 8: 月替わりダイアログ＋今月をリセット

**Files:**
- Modify: `visit-planner.html`

**Interfaces:**
- Consumes: `copyFromPrevMonth`, `showChoice`, `openMonth`, `appData.initializedMonths`, `reserveMode`
- Produces:
  - `maybeInitMonth()` — openMonth 内から呼ぶ。未初期化月なら選択ダイアログ
  - `prevMonthKeyOf(y, m)` → 前月の `'YYYY-MM'`
  - 利用者管理モーダル内の「🗓 今月をリセット」ボタン

- [ ] **Step 1: openMonth に月替わり判定を差し込む**

Task 3 の `openMonth` を置換：

```js
function openMonth(y, m) {
  if (m < 1) { y--; m = 12; }
  if (m > 12) { y++; m = 1; }
  viewYear = y; viewMonth = m;
  renderAll();
  maybeInitMonth();
}

function prevMonthKeyOf(y, m) {
  return m === 1 ? (y - 1) + '-12' : y + '-' + pad2(m - 1);
}

function maybeInitMonth() {
  if (reserveMode) return; // 予約モード中は出さない・initializedMonthsにも入れない
  var mk = curMonthKey();
  if (appData.initializedMonths.indexOf(mk) !== -1) return;
  if (!appData.users.length) return; // 利用者未登録なら出さない
  var prevList = appData.placements[prevMonthKeyOf(viewYear, viewMonth)] || [];
  var existing = curList();
  var reservedCount = existing.length;
  var buttons = [];
  var text = viewMonth + '月の配置をどうしますか？\n';
  if (prevList.length) {
    var preview = copyFromPrevMonth(prevList, existing, appData.users, mk);
    var placed = preview.placements.length - existing.length;
    text += '「前月コピー」: ' + placed + '名を前月と同じ日・枠で配置' +
      (preview.pooled.length ? '（' + preview.pooled.length + '名はプールへ）' : '') +
      (reservedCount ? '（' + reservedCount + '名は予約済み）' : '') + '\n';
    buttons.push({ label: '前月コピー', value: 'copy', primary: true });
  }
  text += '「まっさら」: ' + (reservedCount ? '予約済み' + reservedCount + '名以外を' : '全員を') + 'プールから手で配置';
  buttons.push({ label: 'まっさら', value: 'blank', primary: !prevList.length });
  showChoice(text, buttons).then(function (v) {
    if (v === 'copy') {
      var r = copyFromPrevMonth(prevList, existing, appData.users, mk);
      appData.placements[mk] = r.placements;
    }
    // 'blank' は既存予約を保持したまま何もしない（4.4）
    appData.initializedMonths.push(mk);
    saveData();
    renderAll();
  });
}
```

`init()` 末尾の `renderAll();` の直後に `maybeInitMonth();` を追加（初回表示月も対象にする）。

- [ ] **Step 2: 「今月をリセット」を利用者管理に追加**

`#users-tools` 内にボタン追加：

```html
      <button class="btn danger" id="btn-reset-month">🗓 今月をリセット</button>
```

JS（イベント登録は init() に追記）：

```js
function resetCurrentMonth() {
  var mk = curMonthKey();
  if (!confirm(viewMonth + '月の配置をすべて消します（予約由来の配置も含む）。よろしいですか？')) return;
  delete appData.placements[mk];
  appData.initializedMonths = appData.initializedMonths.filter(function (x) { return x !== mk; });
  saveData();
  closeUsersModal();
  renderAll();
  maybeInitMonth();
}
```

```js
  document.getElementById('btn-reset-month').onclick = resetCurrentMonth;
```

- [ ] **Step 3: 回帰テスト＋ブラウザ確認**

Run: `node --test tests/core.test.js` → PASS

ブラウザ確認：未初期化の翌月を開く→ダイアログ（プレビュー人数付き）／前月コピーで配置再現・✓リセット／まっさらで予約のみ残る／予約モード中に未初期化の来月を開いてもダイアログが出ない→あとで通常に開くと出る・予約は保持／前月データなしなら「前月コピー」ボタン自体が出ない／今月リセット→ダイアログ再表示。

- [ ] **Step 4: コミット**

```bash
git add visit-planner.html
git commit -m "feat: 月替わりダイアログ（initializedMonths方式）と今月リセット"
```

---

### Task 9: スマホ対応＋総合動作確認

**Files:**
- Modify: `visit-planner.html`

**Interfaces:**
- Consumes: `isTouchDevice()`（D&Dは既に無効化済み）
- Produces: 縦積みレスポンシブCSS

- [ ] **Step 1: レスポンシブCSSを追加**

```css
@media (max-width: 767px) {
  main { grid-template-columns: 1fr; height: auto; }
  #pool { max-height: 30vh; }
  .cal-grid { min-width: 560px; }
  #calendar { overflow-x: auto; }
  .cal-slot .check { min-width: 32px; padding: 4px 0; } /* タップしやすく */
}
```

- [ ] **Step 2: 総合動作確認（設計書 §9 の全項目）**

Run: `node --test tests/core.test.js` → 全テストPASS（16以上）

ブラウザ（PC・1366×768相当にウィンドウを縮めて）：
1. 利用者3名登録（1名は火曜NG）→プール五十音順・カウンター一致
2. D&D配置／クリック配置／NG事前ハイライト＋警告キャンセルで無変更
3. 詳細ポップオーバー：時刻編集→リロードで保持／移動／プール戻し＋アンドゥ
4. ✓→3択→はい→予約モード→配置→自動復帰＋📅バッジ
5. ✓キャンセルで✓取り消し／再✓（予約済み）でダイアログなし
6. 翌月を開く→月替わりダイアログ（件数プレビュー）→前月コピー／まっさら（予約保持）
7. 今月リセット→再ダイアログ
8. JSONエクスポート→リセット→インポートで復元
9. リロードしてすべてのデータが保持されること
10. DevToolsのデバイスモード（スマホ幅）：縦積み・横スクロールカレンダー・✓タップと予約フローが動く・D&Dが発動しない

- [ ] **Step 3: 確認結果の記録とコミット**

CLAUDE.md（プロジェクト側）の進捗表を更新し：

```bash
git add -A
git commit -m "feat: スマホ縦積み対応・総合動作確認（設計書v3全項目）"
```

---

## 完了後

- `superpowers:finishing-a-development-branch` に従い、動作確認結果をオーナーへ報告
- GitHub公開（Pages）はオーナーの指示があってから（他アプリと同方式：リポジトリ作成→index.htmlコピー→push）
