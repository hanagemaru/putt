// ランキングの見た目（`docs/ranking.md` §6-3）。**中身の作りだけを持つ。**
//
// 画面の枠（メニューのパネル・戻る・言語切り替え）は `src/entry.ts` が持ち、
// ラウンド終了カードの上に重ねるのも `src/entry.ts` がやる。ここはどちらからも使う部品。
//
// 見た目の約束はメニューと同じ（`entry.ts` の `ensureMenuStyles`）。
// 角丸・ぼかし影は使わず、ドット絵フォント・太い枠・段差のはっきりした影だけで作る。

import { CONFIG } from './config';
import * as i18n from './i18n';
import { t } from './i18n';
import { DEFAULT_PLAYER_NAME, normalizeDisplayName, type RankingBoard } from './ranking-shared';

const R = CONFIG.game.ranking;

/**
 * ランキング表。**枠は画面に収め、中身だけ縦スクロールさせる**
 * （ラウンド終了の一覧表と同じやり方。#score-card.list を参照）
 */
export function rankingTable(board: RankingBoard): HTMLElement {
  ensureRankingStyles();

  const frame = document.createElement('div');
  frame.className = 'ranking-frame';

  if (board.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ranking-empty';
    empty.textContent = t().rankingEmpty;
    frame.append(empty);
    return frame;
  }

  const table = document.createElement('table');
  table.className = 'ranking-table';

  const head = document.createElement('tr');
  head.append(
    headCell(t().colRank),
    headCell(t().colName),
    headCell(t().colStrokes),
    headCell(''),
  );

  const body = document.createElement('tbody');
  body.append(head);

  for (const entry of board.entries) {
    // 上位と自分の周辺の間が飛ぶところに `…` を1本入れる。
    // 順位が続いていないことが分かれば十分なので、飛んだ数は書かない
    if (entry.gapBefore) body.append(gapRow());

    const row = document.createElement('tr');
    row.className = entry.isPlayer ? 'ranking-row you' : 'ranking-row';
    row.append(
      cell(i18n.rankLabel(entry.rank, entry.tied), 'rank'),
      cell(entry.name || DEFAULT_PLAYER_NAME, 'name'),
      cell(i18n.rankingStrokes(entry.strokes, entry.gaveUp), 'strokes'),
      cell(i18n.formatDiff(entry.toPar), 'diff'),
    );
    body.append(row);
  }

  table.append(body);
  frame.append(table);
  return frame;
}

/** 表の下に出す一行。板の人数と、自分の記録が `確認中` のときの断り */
export function rankingFooter(board: RankingBoard, checking: boolean): HTMLElement {
  const footer = document.createElement('div');
  footer.className = 'ranking-footer';
  footer.textContent = checking
    ? `${i18n.playerCountLabel(board.playerCount)}　${t().rankingChecking}`
    : i18n.playerCountLabel(board.playerCount);
  return footer;
}

/** 読み込み中・失敗のときに表の場所へ置く1枚 */
export function rankingNotice(message: string, retry?: () => void): HTMLElement {
  ensureRankingStyles();
  const notice = document.createElement('div');
  notice.className = 'ranking-notice';

  const text = document.createElement('div');
  text.textContent = message;
  notice.append(text);

  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ranking-button';
    button.textContent = t().rankingRetry;
    button.addEventListener('click', retry);
    notice.append(button);
  }
  return notice;
}

export interface NameCardOptions {
  /** 入力欄の初期値。まだ決めていなければ空 */
  initial: string | null;
  /** 決定。整えた後の名前が渡る */
  onSave: (name: string) => void;
  /** 見出し。省略すると「名前を決めてください」 */
  title?: string;
  /** 「あとで」を出す場合の処理。省略すると出さない（後から変える画面では要らない） */
  onCancel?: () => void;
  /** 「あとで」の文言。省略すると「あとで」 */
  cancelLabel?: string;
}

/**
 * 名前を決める1枚（`docs/ranking.md` §6-1）。
 *
 * **聞くのは初回の登録のときだけ。** ラウンド終了カードの上に重ねる使い方と、
 * あとから変える画面の中に置く使い方の両方で同じものを使う。
 * 「あとで」で閉じられるので、名前を入れずに遊び続けられる
 */
export function nameCard(options: NameCardOptions): HTMLElement {
  ensureRankingStyles();

  const card = document.createElement('div');
  card.className = 'name-card';

  const title = document.createElement('div');
  title.className = 'name-title';
  title.textContent = options.title ?? t().nameTitle;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'name-input';
  input.maxLength = R.nameMaxLength;
  input.value = options.initial ?? '';
  input.placeholder = DEFAULT_PLAYER_NAME;
  // 名前は1行。変換候補を出したいので入力の種類は既定のままにする
  input.autocomplete = 'off';

  const note = document.createElement('div');
  note.className = 'name-note';
  note.textContent = t().nameNote;

  const actions = document.createElement('div');
  actions.className = 'name-actions';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'ranking-button primary';
  save.textContent = t().nameSave;

  const submit = (): void => {
    const name = normalizeDisplayName(input.value);
    // 空や長すぎる名前は決定できない。ここで止めて、入力欄へ戻す
    if (!name) {
      input.focus();
      return;
    }
    options.onSave(name);
  };
  save.addEventListener('click', submit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  if (options.onCancel) {
    actions.classList.add('two');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'ranking-button';
    cancel.textContent = options.cancelLabel ?? t().nameLater;
    cancel.addEventListener('click', options.onCancel);
    actions.append(cancel, save);
  } else {
    actions.append(save);
  }

  card.append(title, input, note, actions);
  return card;
}

let nameOverlay: HTMLDivElement | null = null;

/**
 * 名前を決める1枚を、**ラウンド終了カードの上へ重ねる**（`docs/ranking.md` §6-3）。
 * 決めるか「あとで」で閉じるまで、カードのボタンは押させない。
 * 決まったら勝手に閉じるので、呼ぶ側は閉じ方を知らなくてよい
 */
export function showNameOverlay(options: {
  initial: string | null;
  onSave: (name: string) => void;
  onCancel: () => void;
}): void {
  ensureRankingStyles();
  closeNameOverlay();

  const overlay = document.createElement('div');
  overlay.className = 'name-overlay';
  overlay.append(
    nameCard({
      initial: options.initial,
      onSave: (name) => {
        closeNameOverlay();
        options.onSave(name);
      },
      onCancel: () => {
        closeNameOverlay();
        options.onCancel();
      },
    }),
  );
  document.body.append(overlay);
  nameOverlay = overlay;
}

export function closeNameOverlay(): void {
  nameOverlay?.remove();
  nameOverlay = null;
}

function headCell(text: string): HTMLTableCellElement {
  const cell = document.createElement('th');
  cell.textContent = text;
  return cell;
}

function cell(text: string, className: string): HTMLTableCellElement {
  const node = document.createElement('td');
  node.className = className;
  node.textContent = text;
  return node;
}

function gapRow(): HTMLTableRowElement {
  const row = document.createElement('tr');
  row.className = 'ranking-gap';
  const node = document.createElement('td');
  node.colSpan = 4;
  node.textContent = '…';
  row.append(node);
  return row;
}

let stylesReady = false;

/** ランキング表と名前入力の見た目。メニューの色と枠に合わせる */
export function ensureRankingStyles(): void {
  if (stylesReady || document.getElementById('ranking-styles')) {
    stylesReady = true;
    return;
  }
  stylesReady = true;

  const style = document.createElement('style');
  style.id = 'ranking-styles';
  style.textContent = `
    /*
     * 表の枠。**画面に収め、中身だけを縦にスクロールさせる。**
     * 板が育つほど行は増えるので、枠ごと伸ばすと「戻る」が画面から消える
     */
    .ranking-frame {
      margin-top: 16px;
      border: 3px solid #1b3318;
      background: #1b2c1d;
      padding: 8px 6px;
      max-height: 58vh;
      overflow-y: auto;
      touch-action: pan-y;
    }
    .ranking-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 16px;
      line-height: 1.45;
    }
    .ranking-table th {
      padding-bottom: 4px;
      font-weight: 400;
      color: #a8bfae;
      text-align: left;
    }
    .ranking-table th:nth-child(3),
    .ranking-table th:nth-child(4) {
      text-align: right;
    }
    .ranking-table td {
      padding: 3px 0;
    }
    /*
     * 幅の取り合い。**名前をできるだけ残す。**
     * 320px の端末では表に使える幅が 236px しかなく、順位・打数・パー差を
     * 広く取ると名前が4文字で切れる
     */
    .ranking-table td.rank {
      width: 3.2em;
      color: #9ede8a;
    }
    /* 長い名前は折り返さず切る。1行の高さが揃っていないと順位が読みにくい */
    .ranking-table td.name {
      max-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .ranking-table td.strokes {
      width: 3em;
      text-align: right;
    }
    .ranking-table td.diff {
      width: 2.6em;
      text-align: right;
      color: #ffd08a;
    }
    /* 自分の行はコース選択の BEST と同じ扱いで反転させる */
    .ranking-row.you td {
      background: #eef7ec;
      color: #16210f;
    }
    .ranking-row.you td.rank,
    .ranking-row.you td.diff {
      color: #16210f;
    }
    .ranking-gap td {
      padding: 2px 0;
      text-align: center;
      color: #6f8a72;
    }
    .ranking-empty,
    .ranking-notice {
      display: grid;
      justify-items: center;
      gap: 12px;
      margin-top: 16px;
      padding: 18px 12px;
      border: 3px solid #1b3318;
      background: #1b2c1d;
      font-size: 16px;
      line-height: 1.5;
      color: #bcd0c0;
      text-align: center;
    }
    .ranking-footer {
      margin-top: 10px;
      font-size: 16px;
      color: #bcd0c0;
    }
    /* 名前と記録の管理。板の一覧の下へ1つだけ置く */
    .ranking-data-link {
      display: grid;
      margin-top: 22px;
    }
    .ranking-data-slot {
      margin-top: 16px;
    }
    .ranking-data-card {
      margin-top: 16px;
      border: 3px solid #1b3318;
      background: #1b2c1d;
      padding: 14px 12px;
    }
    /*
     * ボタン。**メニューの中でもゲーム画面の上でも同じ見た目にする。**
     * メニューの .course-action は entry.ts がメニューを開いたときにしか差し込まれないので、
     * ラウンド終了カードの上（ゲーム画面）では効かない。ここで同じベベルを持たせる
     */
    .ranking-button {
      appearance: none;
      min-height: 44px;
      border-style: solid;
      border-width: 3px;
      border-color: #9ede8a #1b3318 #1b3318 #9ede8a;
      border-radius: 0;
      background: #3a7332;
      box-shadow: 0 4px 0 #0d140d;
      padding: 12px 10px;
      font-family: inherit;
      font-size: 16px;
      letter-spacing: 0.08em;
      line-height: 1;
      color: #eef7ec;
      white-space: nowrap;
      touch-action: manipulation;
      cursor: pointer;
    }
    /* 押してほしい側は白地。メニューの .course-action.primary と同じ約束 */
    .ranking-button.primary {
      background: #eef7ec;
      border-color: #ffffff #4f9844 #4f9844 #ffffff;
      color: #16210f;
    }
    .ranking-button:active {
      transform: translateY(4px);
      border-color: #1b3318 #9ede8a #9ede8a #1b3318;
      box-shadow: none;
    }
    .ranking-button:focus-visible {
      outline: 3px solid #ffe66d;
      outline-offset: 2px;
    }
    /*
     * 名前を聞く1枚を重ねる層。ラウンド終了カード（z-index 35）より上、
     * 「トップへ戻りますか？」（80）より下に置く。
     * **下を暗くして、決めるか「あとで」で閉じるまでカードを押させない**
     */
    .name-overlay {
      position: fixed;
      inset: 0;
      z-index: 70;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0, 0, 0, 0.58);
      font-family: var(--pixel-font);
      color: #eef7ec;
    }
    .name-overlay .name-card {
      width: min(320px, 100%);
    }
    /* 名前を決める1枚。ラウンド終了カードの上にも、メニューの中にも同じものを置く */
    .name-card {
      border: 3px solid #74cf5c;
      box-shadow: 0 0 0 3px #0d140d, 8px 8px 0 rgba(0, 0, 0, 0.45);
      background: rgba(15, 23, 15, 0.94);
      padding: 16px 14px;
      text-align: left;
    }
    .name-title {
      font-size: 16px;
      color: #9ede8a;
    }
    .name-input {
      appearance: none;
      width: 100%;
      margin-top: 12px;
      border: 3px solid #0d140d;
      border-radius: 0;
      background: #eef7ec;
      padding: 10px;
      font-family: inherit;
      font-size: 16px;
      letter-spacing: 0.06em;
      color: #16210f;
    }
    .name-input:focus-visible {
      outline: 3px solid #ffe66d;
      outline-offset: 2px;
    }
    .name-note {
      margin-top: 8px;
      font-size: 13px;
      line-height: 1.5;
      color: #a8bfae;
    }
    .name-actions {
      display: grid;
      gap: 8px;
      margin-top: 14px;
    }
    .name-actions.two {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  `;
  document.head.append(style);
}
