# BarcodeBattler2-Simulator-Web

バーコードバトラーIIの非公式ブラウザシミュレータ。

https://bb2.koudenpa.net/

参照実装:
[finalfighter/BarcodeBattler2-Simulator](https://github.com/finalfighter/BarcodeBattler2-Simulator)
（ActionScript版、READMEにMIT表記）。元作品の画像・音声は使用していません。
参照したリビジョンは`3211674dede14b5ecc334fd5934e5de7728cf19d`です。

## 実行

Node.js 24以降を使用します。

```sh
npm ci
npm run build
npm run db:local
npm run dev:worker
```

表示されたlocalhostのURLを開きます。UI開発時は別ターミナルで
`npm run dev` を実行すると、`/api` をlocalhost:8787のWorkerに転送します。
Viteのみでもローカル対戦は可能ですが、部屋・商品検索にはWorkerが必要です。

```sh
npm test
npm run typecheck
npm run build
```

依存関係は作成時のnpm最新版で導入し、再現可能なインストール用に
`package-lock.json`を含めています。

## Cloudflareへのデプロイ

要件の「D2」はCloudflare **D1**の意味と解釈しています。
D1には部屋・王者・対戦履歴・匿名セッション・商品キャッシュを、
R2には商品サムネイルを保存します。

```sh
npx wrangler login
```

Wranglerがデプロイ時にD1データベースとR2バケットを自動作成します。
初回デプロイ後にD1マイグレーションを適用します。

```sh
npm run deploy
npm run db:remote
```

CloudflareアカウントでD1/R2を有効にする必要があります。デプロイ先の
`bb2.koudenpa.net`ゾーンをCloudflareアカウントに追加しておいてください。
認証情報や`.dev.vars`はコミットしないでください。

### Amazonアソシエイト商品検索（任意）

Amazonの商品検索リンクはアソシエイトID `koudenpa0a-22` を使い、API認証情報なしで表示します。
商品情報の取得にもCreators APIを使う場合は、日本のアソシエイト・アカウントと
APIクライアント認証情報をWorker Secretとして登録してください。
認証情報があるときはバーコード検索を優先し、商品番号が一致した結果だけを採用します。
一致しない場合やAPI認証情報がない場合はOpen Food Factsにフォールバックします。

```sh
npx wrangler secret put AMAZON_CLIENT_ID
npx wrangler secret put AMAZON_CLIENT_SECRET
```

商品が特定できない場合も、読み取った番号でAmazonを検索するアフィリエイトリンクと
通常リンクを分けて表示します。フッターには
「Amazonのアソシエイトとして、BarcodeBattler2-Simulator-Webは
適格販売により収入を得ています。」と表示します。
Creators APIの利用条件・表示要件に従ってください。

### 旧リビジョンのプレビュー（見た目の比較用）

`.github/workflows/ci-cd.yml` の `legacy-previews` ジョブが、Copilot版（`5bf7dbd`、Cursorによる作り直し前の最後のmain）と
Cursor版（`2070c34`、PR #7）をビルドします。ビルドしたものは、本番とは別の静的アセットだけのWorker
`barcode-battler-web-preview`（`preview/wrangler.jsonc`）に、別名付きの
[Version URL](https://developers.cloudflare.com/workers/configuration/previews/)としてアップロードします。

- URLは `https://copilot-barcode-battler-web-preview.<workers.devのサブドメイン>.workers.dev/` と
  `https://cursor-…` です。Worker自体のURL（別名なし）は両者へのリンク集です。
- Version URLはアップロードしたバージョンの設定で動くため、旧コードが本番のD1/R2に触れないよう、
  APIとバインディングは載せていません。ローカル対戦は動き、勝ち抜き部屋と商品検索は動きません。
- このリポジトリのブランチからのPull Requestと、Actionsの手動実行で動きます（フォークからのPRではSecretsが使えないため動きません）。
  対象リビジョンはジョブの `COPILOT_REF` / `CURSOR_REF` で変えられます。アカウントに`workers.dev`のサブドメインが必要です。

### GitHub ActionsでのCI/CD

`main`へのPull Requestではテスト・型チェック・ビルドを実行し、
`main`へのpushでは成功後にCloudflare Workersへデプロイします。
GitHubリポジトリの **Settings → Secrets and variables → Actions** に
`CLOUDFLARE_API_TOKEN`（Cloudflare APIトークン）と
`CLOUDFLARE_ACCOUNT_ID`（CloudflareアカウントID）をSecretsとして登録してください。
`main`へのデプロイでD1・R2を自動作成し、D1マイグレーションを適用します。
`bb2.koudenpa.net`のゾーンはCloudflareアカウントに追加しておく必要があります。

## 遊び方・対戦部屋

- カメラまたは手入力でJAN/EANの8桁・13桁を読み取ります。チェックデジットを検証します。
- カメラはHTTPS（開発時はlocalhost）と利用者の許可が必要です。
  ネイティブのBarcodeDetectorがないブラウザ（iOS Safari、Firefoxなど）ではWebAssembly版のZXingで読むため、
  WorkerのCSPで`'wasm-unsafe-eval'`を許可しています。
  映像は端末内で解析し、送信しません。カメラを使えない端末では手入力できます。
- 画面は実機の配置に合わせています（画像は自作のCSS/SVGで、原作の画像は使っていません）。
  CARD INで1P/2Pを読み込み、SET（またはL-BATTLE/R-BATTLE）でバトル開始。
  自分の番にBATTLEで攻撃、POWERで回復します。SELECTでC0/C1/C2を切り替え、ON/OFFでリセットします。
  薬草・魔法・強打は本体下の操作パネルから使います。
- ローカル対戦は1P/2Pを読み込んでバトル開始。
- 「1P/2P 合体・アイテム」を選ぶと2枚目を読み込めます。
  対戦部屋ではサーバーが元の1枚から能力を再計算します。
- カードの種類・名前は[バーコードバトラー.net の種族・職業の表](https://barcodebattler.net/page01.htm)に合わせています。
  種族0〜4がキャラカード（機械族・アニマル族・魚族・バード族・ヒューマン族）、
  5〜9がアイテムカード（武器（使い捨て）・武器・防具（使い捨て）・防具・HPアップ）です。
  職業0〜6が戦士、7〜9が魔法使いで、1P/2Pのどちらに読み込んでも読んだバーコードで決まります。
  種族9の前読みカードのうち職業5・6は情報カード、7は薬草アップ、8・9はMPアップとして扱います（参照実装による）。
- アイテムカードは常に2枚目のカードとして扱い、直前に読み込んだキャラカードへ合体します。
  職業が魔法使いのキャラには武器・防具を合体できません（参照元のコメントにある規則。参照元のコードは
  2枚目の職業を判定しているためこの規則が働かず、本実装では1枚目で判定しています）。
- 本体（液晶のメッセージ欄やボタン）には操作の説明を出しません。いま何をすればよいかは操作パネル先頭の帯に、
  ボタンの役割・設定（演出・速度・音）・遊び方は操作パネル下部の折りたたみにまとめています。
- 起動時は勝ち抜き部屋（VS）です。対戦部屋は1Pのバーコードで挑戦します。SELECT（または操作パネルのモード切替）で
  勝ち抜き部屋→C0→C1→C2と切り替わり、
  液晶下の◀▶で部屋を選んでSET（またはL-BATTLE）で挑戦します。
- 演出は既定で「実機再現」です（操作パネルの「設定」で「簡易」に切り替えられます）。参照実装（`barcode2.as`）の
  アニメーションと同じタイミングで、電源投入（ON/OFF）、先攻決定（両端のLEDが200ms間隔で交互に点灯）、
  入力待ち（BATTLE/POWER表示が500ms間隔で交互に点滅）、攻撃（LEDが相手側へ流れ、攻撃側のHP欄に「-」が走ったあと
  ダメージとCRITICAL/MISSが点滅）、回復、CPUの行動前の待ち（800ms）、決着（「0」の点滅のあと「End」）を再現します。
  電子音は参照実装の効果音を10msごとにFFTで解析して、全音の音程・開始時刻・長さを取り出し、Web Audioの矩形波で鳴らしています
  （音声ファイルは同梱していません）。攻撃音は原作と同じく、攻撃ごとに1回通しで鳴ります。
  「バトル速度」はゆっくり／ふつう（実機）／はやい／最速から選べます。設定はブラウザに保存されます。
- カードを読み込むと、実機と同様に液晶の該当欄が「==」で点滅してから能力値を表示します。
  合体するアイテムカードは反対側の欄にアイテムの値を表示します。
- カード欄のバーコードは[Libre Barcode EAN13 Text](https://fonts.google.com/specimen/Libre+Barcode+EAN13+Text)
  （SIL Open Font License 1.1、`@fontsource/libre-barcode-ean13-text`で同梱）で表示します。
- 勝ち抜き部屋の対戦、「最後まで自動で戦う」、C1/C2の敵の手番は、1手ずつ液晶に再生します。
  再生中はSET（または液晶をタップ）で最後まで飛ばせます。勝ち抜き部屋はサーバーのログから
  HPの推移を組み立て、最終HPはサーバーの結果と一致させています。サーバーが能力・勝敗を計算し、
  勝者が王者として残ります。王者自身による連勝稼ぎは受け付けません。
- 部屋は次の3つです（[公式大会レギュレーションの調査](https://github.com/7474/BarcodeBattler2-Simulator-Web/issues/16)を反映）。
  | 部屋 | コード | 2枚目（アイテム・合体） | 回復（薬草・POWER・回復魔法） |
  |---|---|---|---|
  | 規定（キャラカード1枚・無差別） | 制限なし | 不可 | 可 |
  | 49戦（公式大会準拠） | 49始まりのみ（2枚目も） | 可（任意） | 禁止 |
  | 完全無差別 | 制限なし | 可（任意） | 可 |
  - 49戦の回復禁止は公式大会のルールとして確認できたものです。2枚目の可否は参加者の証言と大会で使われた機材の仕様からの推定で、
    当時の大会要項では確認できていません。商品名の申告（実在商品のみ）にあたる確認は、商品データベースに載っていない国内商品が多いため
    無効にしています（`rooms.require_known_product` を1にすると有効になります）。
  - 49は当時の大会レギュレーションであり、商品の原産国を保証するものではありません。
- 部屋とレギュレーション（プレフィックス、2枚目、回復、商品名の確認）はD1のデータとして管理しています。
  将来のユーザー作成部屋に備えた構造ですが、現時点では公開作成APIはありません。
- 匿名セッションはHttpOnly Cookieで保持します。Cookieを削除すると同一利用者として
  認識できなくなります。アカウント認証や強固な不正防止の代わりではありません。
- 同時挑戦が競合した場合は再読込して挑戦し直してください。

### ゲームモードと再現範囲

- C0: 2人の自由対戦。各ターンで攻撃・POWER・薬草・F0〜F9の魔法を操作できます。
- C1: 参照元の敵テーブル、鍵、ボス、成長、パスワードを使用する冒険。
  1人プレイなので、読み込み先・表示は1P/2Pではなく「戦士」「魔法使い」（戦闘中の相手は「敵」）です。
  戦士に職業0〜6、魔法使いに職業7〜9のキャラカード（任意）を読み込み、戦闘前に戦士と魔法使いを交代できます。
  L1〜L5を選択でき、鍵3個でLHが開放されます。
- C2: カメラまたは入力で敵を指定する継続対戦。主人公と敵の残りHP/MP/薬草、
  成長・パスワード処理を保持します。
- 対戦部屋: サーバー上で両者を自動操作します。毎試合元の能力（2枚目を含む）で戦い、
  勝者のバーコード（2枚目を含む）と連勝数を保存します。回復禁止の部屋ではCPUもPOWERを使いません。

**実機完全再現はまだ達成していません。** C1の敵出現順は固定で、
逃走・情報カード表示・戦闘後アイテムメニューは未対応です。
実機のタイミング入力は「通常／強打」の選択に置き換えています。
異常に長い戦闘には無限ループ防止の決着処理があります。
そのため、現状をすべての実機操作を正確に再現した完成版として扱わないでください。

## 商品情報

バーコードから商品名とサムネイルを、次の順に探します。名前が見つかった時点で止めますが、
画像がなければ後の取得元で画像だけ補います。見つからない場合も含め、結果はD1にキャッシュします
（見つかった商品は7日、Amazonは1日、見つからない場合は6時間）。検索障害で対戦は中断しません。

1. Amazon（Creators APIの認証情報がある場合）。識別番号が一致した商品だけ採用します。
2. [Yahoo!ショッピング 商品検索API v3](https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html)の
   JANコード検索（Client IDを`YAHOO_APP_ID`に設定した場合）。国内商品に強く、名前先頭の【送料無料】などの表記は除きます。
   画像はYahoo!の配信URLをそのまま表示し、保存しません。設定時はフッターに
   [規定のクレジット](https://developer.yahoo.co.jp/attribution/)「Webサービス by Yahoo! JAPAN」を表示します。
3. [楽天市場商品検索API](https://webservice.rakuten.co.jp/documentation/ichiba-item-search)
   （アプリIDとアクセスキーを`RAKUTEN_APP_ID`・`RAKUTEN_ACCESS_KEY`に設定した場合）。JAN専用の検索条件がないため、
   JANコードをキーワードにして先頭の1件を使います（商品説明にJANを載せている出品が多いため。まれに別商品が当たる可能性があります）。
   画像は楽天の配信URLをそのまま表示し、保存しません。設定時はフッターに
   [規定のクレジット](https://webservice.rakuten.co.jp/guide/credit)「Supported by Rakuten Developers」を表示します。
4. [openBD](https://openbd.jp/)（ISBN 978/979）。書名と書影（ある場合）を、改変せずに購入リンクと並べて表示します。
   openBDのデータは[本の販促・紹介目的に限り利用できます](https://openbd.jp/terms/)。
5. [Open Food Facts](https://world.openfoodfacts.org/)と姉妹DB（Open Beauty Facts、Open Products Facts、
   Open Pet Food Facts）。日本語名を優先し、なければ英語名・一般名・ブランド名を使います。画像は許可した配信元から取得し、
   サイズ・形式を制限してR2にキャッシュします。[データ利用条件](https://world.openfoodfacts.org/terms-of-use)
   （データベースODbL、個別コンテンツDbCL、画像CC BY-SA）に従ってください。

```sh
npx wrangler secret put YAHOO_APP_ID         # 任意。Yahoo! JAPAN デベロッパーネットワークのClient ID
npx wrangler secret put RAKUTEN_APP_ID       # 任意。楽天ウェブサービスのアプリID
npx wrangler secret put RAKUTEN_ACCESS_KEY   # 任意。同じアプリのアクセスキー（両方そろったときに有効）
npx wrangler secret put YAHOO_AFFILIATE_ID   # 任意。バリューコマースのアフィリエイトID（Yahoo!の商品リンクに付与）
npx wrangler secret put RAKUTEN_AFFILIATE_ID # 任意。楽天アフィリエイトID（楽天の商品リンクに付与）
```

### 既存データの商品解決をやり直す

キャッシュ済みの商品（以前の不具合で名前・画像が空のまま保存された行など）は、GitHub Actionsの
**Refresh products**（`.github/workflows/refresh-products.yml`）を手動実行すると解決し直せます。
WorkerのSecret `ADMIN_TOKEN` と、リポジトリのSecret `ADMIN_TOKEN` に同じ値を設定してください。

```sh
openssl rand -hex 32                     # 生成した値を両方に設定
npx wrangler secret put ADMIN_TOKEN
```

- `scope: missing`（既定）は、名前も画像もない行、商品ページのリンクがまだない行、
  商品データのない王者のカード（2枚目を含む）が対象です。
  `scope: all` はキャッシュ済みの全商品をやり直します。
- 管理API `POST /api/admin/products/refresh`（`Authorization: Bearer <ADMIN_TOKEN>`、
  本文 `{"scope":"missing","limit":5,"after":""}`）を、返る `next` を `after` に渡しながら `done` になるまで呼びます。
  1回あたりの件数は1〜20件です（Workersのサブリクエスト上限と、Yahoo!・楽天への連続アクセスの抑制を考慮）。
- `ADMIN_TOKEN` を設定していないあいだ、管理APIは404を返します。

Yahoo!ショッピング・楽天市場・Open Food Facts系で見つかった商品は、サムネイルと「〇〇で見る」リンクから
取得元の商品ページへリンクします。アフィリエイトIDを設定した場合、そのリンクはアフィリエイトリンクになり、
「（アフィリエイト）」と表示して`rel="sponsored"`を付け、フッターに利用しているプログラムを開示します。
Amazon商品にはアフィリエイトリンクとアフィリエイトを含まない商品ページリンクを併記します。
商品を特定できない場合は、バーコード（JAN/EAN/ISBN）でのAmazon検索リンクを併記します。
外部サービスへの照会にバーコード番号を使用します。カメラ映像は使用しません。

## ライセンス

本プロジェクトはMIT Licenseで公開しています。詳細は[LICENSE](LICENSE)を参照してください。

## 運用上の注意

部屋の更新と対戦記録はD1の条件付き更新・トランザクションで処理します。
ゲームAPIは同一オリジンから利用してください。無料枠の上限と公開運用時のアクセス制限、
バックアップ、古い対戦履歴・セッション・レート制限データの削除方針は運用者が設定してください。
実機や参照元との差異は、再現バーコードと操作手順を添えて報告してください。
