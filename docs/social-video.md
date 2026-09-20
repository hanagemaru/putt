# Social gameplay video recorder

X などへ載せる縦型プレイ動画を、実ゲーム UI と本番の入力・物理経路で再現可能に生成する手順。

## 正本

- workflow: `.github/workflows/social-video.yml`
- ショット探索: `scripts/solve-social-shot.ts`
- 録画操作: `scripts/record-social-video.mjs`
- 録画専用入口: `?social=1` のときだけ `window.__puttSocial` を公開する
- 通常プレイでは録画用 API を公開しない

## 成功した方式

1. `npm run --silent social:solve > social-plan.json` で決定論的にカップインする seed / speed / direction を探す
2. 通常の Vite build を行う
3. `npm run preview -- --port 4173` で配信する
4. Vite の base path が `/putt/` なので、ローカル録画 URL は `http://127.0.0.1:4173/putt/` を使う
5. Playwright Chromium を 390x640 で起動し、実際の UI を録画する
6. マップ表示後、最終解へ一発でスナップせず、小さなオーバーシュートと修正を数回入れて人間らしく狙う
7. STROKE canvas を実際に操作する。録画用 `launch()` で直接発射しない
8. CDP の mouse event timestamp を使い、見た目のストローク時間と SwipeMeasure が読む速度を分離する
9. バックスイング・ダウンスイングは大きく見せ、微小な縦ブレを入れる。ただしインパクト直前約40msは solver の speed/direction に正確に合わせる
10. `lastShot()` で実際に記録された speed/direction と solver plan を照合する
11. `PRACTICE_END` まで待ち、結果カードを約1.8秒保持する
12. ffmpeg で冒頭0.8秒を切り、H.264 / yuv420p / 30fps / faststart の MP4 にする

## 重要な失敗ポイント

- preview の root `http://127.0.0.1:4173` を待つだけでは不十分。build の base path に合わせて `/putt/` を使う
- Playwright の普通の wall-clock drag だけで solver の速度を再現しようとすると、見た目が速すぎる/短すぎる。CDP timestamp を使う
- solver の方向へ即座に aim すると機械的に見える。最終値は変えず、その手前の調整だけ人間らしくする
- ストローク全体をブレさせると SwipeMeasure の最終フィットまで変わり、カップインが不安定になる。ブレは主にインパクトより前へ置く
- 録画開始直後には読み込み画面が含まれるため、エンコード時に先頭をトリムする
- 結果カード直後に context を閉じると HOLE IN ONE が読めないため、終了後に待機を入れる

## 再生成

GitHub Actions の **Social Video** workflow を実行する。branch 上の push でも自動実行される。
成功すると artifact `putt-social-video` に以下が入る。

- `putt-social.mp4`
- `social-plan.json`

solver と入力経路の照合が通らない場合は workflow を失敗させ、見た目だけ成功した動画を成果物にしない。
