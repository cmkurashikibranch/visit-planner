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
             copyFromPrevMonth, sanitizeData, SLOT_TIMES, SLOT_LABELS, TYPES,
             isSunday, holidayKindOf, isSlotBlocked, availableSlotCount,
             placementsBlockedBy, conflictSummary, kanaKey, compareUsers, HOLIDAY_KINDS, CAL_DOWS };`)();

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
    meeting:    { label: '会議',   color: '#D93025' },
    other:      { label: '他',     color: '#188038' }
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

test('sanitizeData: null は初期データ（version 3）', () => {
  const r = core.sanitizeData(null);
  assert.deepStrictEqual(r.data,
    { version: 3, users: [], placements: {}, holidays: {}, initializedMonths: [], nextId: 1 });
  assert.strictEqual(r.migratedPooled, 0);
  assert.strictEqual(r.sundayPooled, 0);
  assert.strictEqual(r.holidayPooled, 0);
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
  assert.strictEqual(r.data.version, 3);
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
  assert.deepStrictEqual(r.data.users[0], { id: 1, name: '山田', kana: '', ngDays: [], memo: '' });
  assert.deepStrictEqual(r.data.placements, {});
  assert.strictEqual(r.data.nextId, 2); // maxId+1
});


/* ===== v2.2 追加分：休日・日曜廃止・ふりがな順 ===== */

test('isSlotBlocked / availableSlotCount：休み・AM休・PM休', () => {
  const h = { '2026-09-01': 'full', '2026-09-02': 'am', '2026-09-03': 'pm' };
  assert.deepStrictEqual([1, 2, 3, 4].map(s => core.isSlotBlocked(h, '2026-09-01', s)),
    [true, true, true, true]);
  assert.deepStrictEqual([1, 2, 3, 4].map(s => core.isSlotBlocked(h, '2026-09-02', s)),
    [true, true, false, false]);
  assert.deepStrictEqual([1, 2, 3, 4].map(s => core.isSlotBlocked(h, '2026-09-03', s)),
    [false, false, true, true]);
  assert.strictEqual(core.isSlotBlocked(h, '2026-09-04', 1), false); // 休みでない日
  assert.strictEqual(core.availableSlotCount(h, '2026-09-01'), 0);
  assert.strictEqual(core.availableSlotCount(h, '2026-09-02'), 2);
  assert.strictEqual(core.availableSlotCount(h, '2026-09-04'), 4);
});

test('holidayKindOf：未知の種別・未設定は null', () => {
  assert.strictEqual(core.holidayKindOf({ '2026-09-01': 'am' }, '2026-09-01'), 'am');
  assert.strictEqual(core.holidayKindOf({ '2026-09-01': 'zzz' }, '2026-09-01'), null);
  assert.strictEqual(core.holidayKindOf({}, '2026-09-01'), null);
  assert.strictEqual(core.holidayKindOf(undefined, '2026-09-01'), null);
});

test('placementsBlockedBy：AM休は午前2枠だけを弾く', () => {
  const list = [
    P({ date: '2026-09-02', slot: 1 }),
    P({ userId: 2, date: '2026-09-02', slot: 3 }),
    P({ userId: 3, date: '2026-09-03', slot: 1 })   // 別の日は対象外
  ];
  const blocked = core.placementsBlockedBy(list, '2026-09-02', 'am');
  assert.strictEqual(blocked.length, 1);
  assert.strictEqual(blocked[0].slot, 1);
  assert.strictEqual(core.placementsBlockedBy(list, '2026-09-02', 'full').length, 2);
  assert.strictEqual(core.placementsBlockedBy(list, '2026-09-02', 'pm').length, 1);
});

test('kanaKey：カタカナ→ひらがな・空白は無視', () => {
  assert.strictEqual(core.kanaKey('ヤマダ タロウ'), 'やまだたろう');
  assert.strictEqual(core.kanaKey('やまだ　たろう'), 'やまだたろう');
  assert.strictEqual(core.kanaKey(undefined), '');
  assert.strictEqual(core.kanaKey(''), '');
});

test('compareUsers：ふりがな順が先、ふりがな無しは後ろで名前順', () => {
  const U = (id, name, kana) => ({ id, name, kana, ngDays: [], memo: '' });
  const users = [
    U(1, '山田', 'やまだ'),
    U(2, '安藤', ''),        // ふりがな無し
    U(3, '伊藤', 'いとう'),
    U(4, '渡辺', '')         // ふりがな無し
  ];
  const sorted = users.slice().sort(core.compareUsers).map(u => u.name);
  assert.deepStrictEqual(sorted, ['伊藤', '山田', '安藤', '渡辺']);
});

test('compareUsers：ふりがなが同じなら名前で決める', () => {
  const a = { id: 1, name: '斎藤', kana: 'さいとう', ngDays: [], memo: '' };
  const b = { id: 2, name: '斉藤', kana: 'サイトウ', ngDays: [], memo: '' };
  assert.notStrictEqual(core.compareUsers(a, b), 0);
  assert.strictEqual(core.compareUsers(a, b), -core.compareUsers(b, a));
});

test('copyFromPrevMonth：コピー先が日曜ならプール行き', () => {
  const users = [{ id: 1, name: '山田', kana: '', ngDays: [], memo: '' }];
  const prev = [P({ date: '2026-08-06' })];              // 8/6(木)
  const r = core.copyFromPrevMonth(prev, [], users, '2026-09', {}); // 9/6は日曜
  assert.strictEqual(core.dayOfWeek('2026-09-06'), 0);
  assert.strictEqual(r.placements.length, 0);
  assert.deepStrictEqual(r.pooled, [1]);
});

test('copyFromPrevMonth：コピー先が休みの枠ならプール行き', () => {
  const users = [{ id: 1, name: '山田', kana: '', ngDays: [], memo: '' }];
  const prev = [P({ date: '2026-08-03', slot: 1 })];      // 午前①
  const holidays = { '2026-09-03': 'am' };
  const r = core.copyFromPrevMonth(prev, [], users, '2026-09', holidays);
  assert.strictEqual(r.placements.length, 0);
  assert.deepStrictEqual(r.pooled, [1]);
  // PM休なら午前①は生き残る
  const r2 = core.copyFromPrevMonth(prev, [], users, '2026-09', { '2026-09-03': 'pm' });
  assert.strictEqual(r2.placements.length, 1);
  assert.deepStrictEqual(r2.pooled, []);
});

test('copyFromPrevMonth：holidays 省略でも動く（後方互換）', () => {
  const users = [{ id: 1, name: '山田', kana: '', ngDays: [], memo: '' }];
  const r = core.copyFromPrevMonth([P({ date: '2026-08-03' })], [], users, '2026-09');
  assert.strictEqual(r.placements.length, 1);
});

test('sanitizeData：日曜の配置はプールへ戻して sundayPooled に計上', () => {
  const raw = {
    version: 2,
    users: [{ id: 1, name: '山田', ngDays: [], memo: '' }, { id: 2, name: '佐藤', ngDays: [], memo: '' }],
    placements: {
      '2026-07': [
        P({ date: '2026-07-05' }),               // 日曜→プール
        P({ userId: 2, date: '2026-07-08' })     // 水曜→残る
      ]
    },
    initializedMonths: [],
    nextId: 3
  };
  const r = core.sanitizeData(raw);
  assert.strictEqual(r.sundayPooled, 1);
  assert.strictEqual(r.data.placements['2026-07'].length, 1);
  assert.strictEqual(r.data.placements['2026-07'][0].userId, 2);
});

test('sanitizeData：休みの枠の配置はプールへ戻して holidayPooled に計上', () => {
  const raw = {
    version: 3,
    users: [{ id: 1, name: '山田', kana: 'やまだ', ngDays: [], memo: '' }],
    holidays: { '2026-07-08': 'am' },
    placements: { '2026-07': [P({ date: '2026-07-08', slot: 1 })] }, // 午前①→AM休で弾かれる
    initializedMonths: [],
    nextId: 2
  };
  const r = core.sanitizeData(raw);
  assert.strictEqual(r.holidayPooled, 1);
  assert.strictEqual(r.data.holidays['2026-07-08'], 'am');
  assert.strictEqual((r.data.placements['2026-07'] || []).length, 0);
  assert.strictEqual(r.data.users[0].kana, 'やまだ');
});

test('sanitizeData：不正な休日（種別違い・日付違い・日曜）は捨てて警告', () => {
  const raw = {
    version: 3,
    users: [],
    holidays: { '2026-07-08': 'am', '2026-07-09': 'zzz', 'bad': 'full', '2026-07-05': 'full' },
    placements: {},
    initializedMonths: [],
    nextId: 1
  };
  const r = core.sanitizeData(raw);
  assert.deepStrictEqual(Object.keys(r.data.holidays), ['2026-07-08']);
  assert.strictEqual(r.warned, true);
});

test('sanitizeData：v1 データにも holidays が生える（空）', () => {
  const r = core.sanitizeData({ version: 1, users: [], placements: {}, nextId: 1 });
  assert.deepStrictEqual(r.data.holidays, {});
  assert.strictEqual(r.data.version, 3);
});

test('種別の色：会議は赤・その他は緑', () => {
  assert.strictEqual(core.TYPES.meeting.color, '#D93025');
  assert.strictEqual(core.TYPES.other.color, '#188038');
  assert.strictEqual(core.TYPES.monitoring.color, '#7C3AED');
});

test('CAL_DOWS：月〜土の6列（日曜を含まない）', () => {
  assert.deepStrictEqual(core.CAL_DOWS, [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(core.isSunday('2026-07-05'), true);
  assert.strictEqual(core.isSunday('2026-07-06'), false);
});

test('conflictSummary：モニタはプールへ戻る・会議と他は削除される', () => {
  const mon = P({ type: 'monitoring' });
  const meet = P({ userId: 2, slot: 2, type: 'meeting' });
  const other = P({ userId: 3, slot: 3, type: 'other' });
  assert.strictEqual(core.conflictSummary([mon]), 'モニタ 1件はプールへ戻ります');
  assert.strictEqual(core.conflictSummary([meet, other]), '会議・他 2件は削除されます');
  assert.strictEqual(core.conflictSummary([mon, meet]),
    'モニタ 1件はプールへ戻ります／会議・他 1件は削除されます');
  assert.strictEqual(core.conflictSummary([]), '');
  // past=true は完了形（トースト用）
  assert.strictEqual(core.conflictSummary([mon, meet], true),
    'モニタ 1件をプールへ戻しました／会議・他 1件を削除しました');
});

test('sanitizeData：holidays の値が文字列でなければ弾く（配列の素通しを防ぐ）', () => {
  const r = core.sanitizeData({ version: 3, users: [], placements: {},
    holidays: { '2026-09-01': ['full'], '2026-09-02': 'am' }, initializedMonths: [], nextId: 1 });
  assert.deepStrictEqual(Object.keys(r.data.holidays), ['2026-09-02']);
  assert.strictEqual(r.warned, true);
});
