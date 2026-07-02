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
             isSlotFree, isPlacedInMonth, countUnplaced, addPlacement, movePlacement,
             copyFromPrevMonth, sanitizeData, SLOT_TIMES };`)();

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

test('copyFromPrevMonth：予약済み利用者は除外・予約枠との衝突はプール行き', () => {
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
