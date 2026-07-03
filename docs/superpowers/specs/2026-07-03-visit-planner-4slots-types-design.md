# 訪問調整アプリ改修：4枠化＋種別（モニタリング/担当者会議/その他）設計書

日付: 2026-07-03
対象: `visit-planner.html`（単一HTML + localStorage）
前提: 初版設計書 `2026-07-02-visit-planner-design.md`（v2）の仕様を引き継ぎ、本書の差分のみ変更する

## 1. 変更概要

| # | 変更 | 内容 |
|---|------|------|
| 1 | 枠構成 | 1日3枠（①13:00/②14:30/③16:00）→ **4枠（午前①10:00/午前②11:00/午後①14:00/午後②15:30）** |
| 2 | 種別 | 配置に `type` を追加：**モニタリング（monitoring）/担当者会議（meeting）/その他（other）**。配置時に選ぶ・後から変更可 |
| 3 | 月内複数配置 | 同一利用者を月に2件以上配置可能に（モニタリングのみ月1件まで） |
| 4 | プールの意味 | プール＝「今月**モニタリング**が未配置の人」。会議/その他の配置はプール消込に影響しない |
| 5 | 空き枠クリック配置 | 空き枠を直接クリック→利用者と種別を選んで配置（会議/その他・月2件目以降の入口） |

既定時刻は配置後にポップオーバーで手入力変更可（現行機能を維持）。

## 2. データ構造の変更

### 2.1 配置オブジェクト

```json
{ "userId": 3, "date": "2026-07-15", "slot": 3, "time": "14:00",
  "type": "monitoring", "done": false, "gcalEventId": null }
```

- `slot`: 1=午前① / 2=午前② / 3=午後① / 4=午後②
- `type`: `"monitoring" | "meeting" | "other"`（欠損・不正値は `"monitoring"` に修復して warned）

### 2.2 定数

```js
var SLOT_TIMES  = { 1: '10:00', 2: '11:00', 3: '14:00', 4: '15:30' };
var SLOT_LABELS = ['午前①', '午前②', '午後①', '午後②'];
var TYPES = {
  monitoring: { label: 'モニタ', color: '#7C3AED' },  // 紫（スケジュール管理アプリと統一）
  meeting:    { label: '会議',   color: '#3B50A0' },  // 紺
  other:      { label: '他',     color: '#6B7280' }   // グレー
};
```

### 2.3 バージョンと旧データ移行（sanitizeData内）

- `version: 1` → `version: 2` に引き上げ。sanitizeData は常に v2 形式で出力する
- **v1 データ（`raw.version === 1` または version 欠損）の移行規則:**
  - 旧 slot 1（13:00）→ 新 slot 3（午後①）
  - 旧 slot 2（14:30）→ 新 slot 4（午後②）
  - 旧 slot 3（16:00）→ 行き先がないため**配置から除外**（＝プールに戻る）。除外件数を数え、起動時バナーで「旧データを新しい枠割りに移行しました（N件はプールに戻しました）」と通知
  - `time` は保存値をそのまま保持（13:00 等のまま。既定時刻は新規配置にのみ適用）
  - `type` は全件 `"monitoring"`
- v2 データはそのまま検証（slot は 1〜4、type は3値のいずれか）
- JSONインポートも同じ経路を通るため、旧エクスポートファイルの取り込みも自動移行される

## 3. CORE純関数の変更

| 関数 | 変更 |
|------|------|
| `isPlacedInMonth(list, userId)` | → **`hasMonitoringInMonth(list, userId)`** に改名。`type === 'monitoring'` の配置があるかだけを見る |
| `countUnplaced(users, list)` | hasMonitoringInMonth 基準に変更（プールカウンターと連動） |
| `addPlacement(list, userId, date, slot, time, type)` | `type` 引数を追加。**重複ガードは type が monitoring のときだけ**（`hasMonitoringInMonth` で判定、reason: 'duplicate'）。meeting/other は同一利用者でも制限なし。枠占有ガード（occupied）は全種別共通 |
| `movePlacement(list, source, target)` | 変更なし（type はコピーで引き継がれる） |
| `copyFromPrevMonth(prevList, ...)` | **モニタリングのみコピー対象**（meeting/other はスキップ）。重複判定は hasMonitoringInMonth。コピー結果の type は monitoring |
| `sanitizeData(raw)` | §2.3 の移行＋type検証を追加。重複ガードも monitoring 限定に変更。戻り値に `migratedPooled`（旧slot3の除外件数、v1移行時のみ>0）を追加 |

## 4. UIの変更

### 4.1 カレンダー描画

- 枠ループを 1〜4 に。空き枠ラベルは `SLOT_LABELS`（午前①〜午後②）
- 日ヘッダの埋まり数は `n/4`
- 配置済みピース表示: `[色帯][種別チップ][⚠NG][名前][📅来月][✓/○]`
  - 色帯: 左ボーダー4pxを type 色に（現行の `--visit` 固定を置き換え）
  - 種別チップ: `TYPES[type].label` を type 色の小さなバッジで表示
- 完了（done）時のグレーアウトは現行どおり（色帯・チップも減光）

### 4.2 空き枠クリック → 配置ポップオーバー（新規）

- 発火条件: `!selectMode && !reserveMode` で空き枠（`.cal-slot:not(.filled)`）をクリック
  （selectMode/reserveMode 中の空き枠クリックは従来どおりそれぞれの配置処理）
- 内容:
  - 見出し「7/15 午後① に配置」
  - 利用者 `<select>`: 全利用者を五十音順。モニタ配置済みの人には「（モニタ済）」を付記
  - 種別: モニタ/会議/他 の3ボタン切替（既定=モニタ）
  - [配置] [キャンセル]
- [配置] 時は既存の共通経路（NG曜日 confirm → addPlacement）に合流。モニタ重複は
  「今月のモニタリングは配置済みです。種別を変更してください」とトースト表示して配置しない
- 詳細ポップオーバーと同じ closePopover 管理に乗せる（同時に1つだけ）

### 4.3 プール（左サイド）

- 表示・D&D・クリック配置は現行のまま。**プールからの配置は常に type=monitoring**（ダイアログなし）
- プールの消込・「未配置: N名」カウンターは hasMonitoringInMonth 基準

### 4.4 詳細ポップオーバー（配置済みクリック）

- 既存の「時刻・移動・プールに戻す」に**種別の3ボタン切替を追加**（変更で即保存・再描画）
- monitoring→meeting 等に変更すると、その人のモニタリングが未配置扱いになり**プールに再表示される**（仕様どおりの挙動。トーストで「◯◯さんがプールに戻りました（モニタリング未配置）」と補足）
- 「プールに戻す」は種別を問わず配置を削除する（文言は「配置を取り消す」に変更。meeting/other はプール表示と無関係のため）

### 4.5 ✓チェックと来月予約

- **monitoring の✓** → 従来どおり「来月の予約を入れますか？」3択。予約配置も type=monitoring。
  予約済み判定（ダイアログ省略・📅バッジ）は来月リストの hasMonitoringInMonth で判定
- **meeting / other の✓** → done を切り替えるだけ（来月予約ダイアログは出さない）

### 4.6 配置トースト

- 文言の枠表記を「15日①」→「15日午後①」形式に更新

## 5. 変更しないもの

- 利用者マスタ（名前・NG曜日・メモ）、JSONエクスポート/インポートの操作、アンドゥ（スナップショット方式のため種別変更もそのまま巻き戻る）、月替わりダイアログの流れ、スマホ縦積みレイアウト、D&D=PC専用の方針、localStorage キー（`visit-planner-v1` のまま。版管理は data.version で行う）

## 6. テスト（tests/core.test.js）

- 既存16テストを新仕様（4枠・type引数・hasMonitoringInMonth）に更新
- 追加テスト:
  1. addPlacement: meeting は同一利用者に月2件以上OK
  2. addPlacement: monitoring の2件目は duplicate で拒否
  3. addPlacement: type が配置オブジェクトに保存される
  4. countUnplaced: meeting のみ配置の利用者は未配置のまま
  5. copyFromPrevMonth: meeting/other はコピーされない
  6. sanitizeData: v1→v2 移行（slot 1→3, 2→4, 3は除外＋migratedPooled件数）
  7. sanitizeData: type 欠損は monitoring に修復（warned）
  8. sanitizeData: 同一利用者の monitoring 重複は2件目を除去、meeting 重複は保持
- 全テストパスを完了条件とする（`node --test tests/core.test.js`）

## 7. 受け入れ確認（ブラウザ実表示）

1. 1日に4枠（午前①〜午後②）が表示され、既定時刻が 10:00/11:00/14:00/15:30 で入る
2. プールから配置→紫「モニタ」ピース。プールから消える
3. 空き枠クリック→同じ利用者を「会議」で配置できる（紺「会議」チップ。プールには影響なし）
4. 同じ利用者のモニタ2件目はトーストで拒否される
5. 詳細ポップオーバーで種別変更→色が変わる。モニタ→会議でプールに再表示
6. モニタ✓→来月予約フロー動作。会議✓はダイアログなし
7. 旧データ（v1のJSON）インポート→午後枠に移行され、旧③はプールへ（バナー通知）
8. 時刻の手入力変更が全4枠で可能
9. スマホ幅（390px）で4枠が縦に収まり操作できる
