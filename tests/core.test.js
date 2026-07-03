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
