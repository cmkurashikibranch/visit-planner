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
