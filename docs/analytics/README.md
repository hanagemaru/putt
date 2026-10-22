# 最小プレイ計測（2026-10-22）

目的: 広告や共有から来た訪問が、初打・途中ホール・最終ホールまで到達するかを比較する。
計測基盤の拡張やゲーム完成そのものを目的にしない。

## 状態と有効化

実装済み、既定は無効。本番で受信したことは未確認。次の順で有効化する。

1. ハブの公開プライバシーポリシー（日英）に、下記の保存内容・用途・期間を追記し公開する。
2. このPRをマージ後、既存 `Apply D1 migrations` Actions を dry=true で確認し、dry=false で `0003_gameplay_events.sql` を適用する。ランキング表には変更を加えない。
3. `wrangler.jsonc` の `vars.GAMEPLAY_ANALYTICS` を `true` にし、GitHub Repository variable `GAMEPLAY_ANALYTICS=true` を設定して本番ビルド・配信する。両方が必要。プレビューでは送信しない。
4. 本番の通常入口→初打→ホール終了→9ホール終了を実機確認する。D1で1つのsession_idに各イベントが保存されること、同じ内容の再送が増えないことを確認する。名前登録は不要。
5. `funnel.sql` をD1コンソール等で実行し、同じ期間の流入と到達数を比較する。共有導線の追加前に基準値を残す。

停止はRepository variableをfalseにして再ビルド（クライアント停止）、Workerのvarsもfalseにして配信（旧キャッシュを含む受信停止）。
イベント受信はプライバシー公開・移行完了前には有効化しない。

## 保存するもの・保存しないもの

- メニューを含む通常入口の `visit`、通常ツアーの `first_shot`、`hole_complete`、`round_complete`。
- ランキングとは無関係のランダムなタブ内セッションID。sessionStorageでページ遷移を越えて保持し、イベント発生から30分以上空いたら更新。Cookie・localStorage・永続的な訪問者IDは使わない。
- サーバー受信時刻、コースID、ホール番号、カップイン/ギブアップ。
- 流入分類は `x_ads/x_share/x_other/hub/search/other/direct` の固定値のみ。最初の入口で分類し、30分以内の同一タブでは引き継ぐ。広告UTMは `utm_source=x&utm_medium=cpc`（paid_socialも可）、共有は `utm_source=x&utm_medium=share`。UTMなしのt.coは広告と断定せずx_other。
- 生URL・検索語・任意UTM文字列・参照元URL・IP・ユーザーエージェント・名前・ランキングID・認証情報・操作リプレイは計測表へ保存しない。ホスティング側のログとは別。
- 受信処理時に30日を超えた行を削除する。無流入の間は削除が走らないため厳密な30日破棄ではない。運営終了・計測停止時は `DELETE FROM gameplay_events` で削除する。
- 生データを公開する取得APIは設けない。

公開文案（日英、**公開前に現行ページへ統合する**）:

> Puttでは、ゲーム改善のため、訪問、最初のショット、ホール終了、ラウンド終了を集計する場合があります。短時間のタブ内セッションを区別するランダムなIDと、流入元の分類、コース、到達ホール、終了状態、受信時刻を保存します。このIDはランキングの名前や認証情報には結び付けず、タブ内のsessionStorageで保持し、操作の計測が30分以上空いたら更新します。生の参照元URLやUTM値は保存しません。記録は受信処理時に30日を超えたものを削除し、計測停止時にも削除します。

> Putt may collect visits, first shots, hole finishes and round finishes to improve the game. We store a random short-lived tab-session ID, acquisition category, course, hole reached, finish status and receipt time. This ID is held in sessionStorage, renewed after 30 minutes without a measured action, and is not linked to ranking names or credentials. Raw referrer URLs and UTM values are not stored. Records older than 30 days are deleted when new events are received; records are also deleted when collection is discontinued.

## 定義と限界

- 1訪問は「30分無操作までの1タブ」。Cloudflare Visits、Xクリック、ユニーク人数とは定義が違う。日をまたいだ活動中タブは同じ訪問。新しいタブは別訪問。
- メニューだけで離脱した訪問も分母へ入る。練習の入口は分母に含むが、練習のショット/終了は集計しない。通常ツアーへの到達を見るためである。
- 各イベントはセッション・コース・ホールごとに1件。打数やラウンド回数の計測ではない。同じツアーへの再挑戦も同一訪問内では重複しない。
- `hole_complete` はギブアップを含むので outcome で分けられる。`round_complete` は第9ホールのスコア確定（ギブアップを含む）。終了カードへの追加タップやランキング登録の有無には依存しない。
- 再開データから最後まで進むことも含む。「その訪問で9ホール全部を遊んだ率」とは呼ばない。queryの最終ホール到達はfirst_shotの部分集合とも限らない（再開直後のギブアップなど）。
- 訪問IDで後日を結び付けないため、翌日/翌週の再訪率・コホート継続率はまだ測れない。継続率を必要とする週間施策の前に保存方式・同意/説明を決める。
- オフライン、通信失敗、ストレージ制限、拡張機能等で欠測する。ストレージが使えないとページ遷移ごとに別訪問になる。失敗は操作を止めず、次の計測機会に再試行することがある。
- 本番ホストのみ送信・受信。録画、デバッグ、調整URL、専用検証ページは除外。直接偽造されたリクエストへの完全な不正防止ではない。賞品や広告費回収判定に使う精度を保証しない。

## 次の1件

Puttの結果画面へ日英のX共有を追加し、共有リンクに `utm_source=x&utm_medium=share` を付ける。
まず共有経由の訪問・初打が生まれるかを確認する。週間報酬・個別OGP生成・共通基盤化はその前提にしない。
