# BarcodeBattler2-Simulator-Web

バーコードバトラーIIの非公式ブラウザシミュレータ。参照実装:
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
npx wrangler d1 create barcode-battler
npx wrangler r2 bucket create barcode-battler-images
```

作成結果のD1 `database_id`を`wrangler.jsonc`に設定してから実行します。

```sh
npm run db:remote
npm run deploy
```

CloudflareアカウントでD1/R2を有効にする必要があります。
認証情報や`.dev.vars`はコミットしないでください。

### Amazonアソシエイト商品検索（任意）

日本のAmazon Creators APIを使うには、日本のアソシエイト・アカウントとAPIクライアント認証情報が必要です。
次の3つをWorker Secretとして登録すると、
バーコード検索時にAmazonを優先し、商品番号が一致した結果だけを採用します。
一致しない場合やAPIが利用できない場合はOpen Food Factsにフォールバックします。

```sh
npx wrangler secret put AMAZON_CLIENT_ID
npx wrangler secret put AMAZON_CLIENT_SECRET
npx wrangler secret put AMAZON_ASSOCIATE_TAG
```

`AMAZON_ASSOCIATE_TAG`には日本のアソシエイトID（例: `example-22`）を設定します。
3つの値が揃っている場合だけAmazon検索とアフィリエイト表示が有効です。
有効時は商品ページにアフィリエイトリンクと通常リンクを分けて表示し、
フッターに「Amazonのアソシエイトとして、BarcodeBattler2-Simulator-Webは
適格販売により収入を得ています。」と表示します。
Creators APIの利用条件・表示要件に従ってください。

## 遊び方・対戦部屋

- カメラまたは手入力でJAN/EANの8桁・13桁を読み取ります。チェックデジットを検証します。
- カメラはHTTPS（開発時はlocalhost）と利用者の許可が必要です。
  映像は端末内で解析し、送信しません。カメラを使えない端末では手入力できます。
- ローカル対戦は1P/2Pを読み込んでバトル開始。
- 「1P/2P 合体・アイテム」を選ぶと2枚目を読み込めます。
  対戦部屋ではサーバーが元の1枚から能力を再計算します。
- 対戦部屋は1Pのバーコードで挑戦します。サーバーが能力・勝敗を計算し、
  勝者が王者として残ります。王者自身による連勝稼ぎは受け付けません。
- 初期部屋は「国内49コード」（49で始まるコード）と「無差別」。
  49はこのゲームのレギュレーションであり、商品の原産国を保証するものではありません。
- 部屋とプレフィックス制限はD1のデータとして管理しています。
  将来のユーザー作成部屋に備えた構造ですが、現時点では公開作成APIはありません。
- 匿名セッションはHttpOnly Cookieで保持します。Cookieを削除すると同一利用者として
  認識できなくなります。アカウント認証や強固な不正防止の代わりではありません。
- 同時挑戦が競合した場合は再読込して挑戦し直してください。

### ゲームモードと再現範囲

- C0: 2人の自由対戦。各ターンで攻撃・POWER・薬草・F0〜F9の魔法を操作できます。
- C1: 参照元の敵テーブル、鍵、ボス、成長、パスワードを使用する冒険。
  戦士と魔法使いを読み込み、戦闘前に主人公を交代できます。
  L1〜L5を選択でき、鍵3個でLHが開放されます。
- C2: カメラまたは入力で敵を指定する継続対戦。主人公と敵の残りHP/MP/薬草、
  成長・パスワード処理を保持します。
- 対戦部屋: サーバー上で両者を自動操作します。毎試合元の能力で戦い、
  勝者のバーコードと連勝数を保存します。

**実機完全再現はまだ達成していません。** C1の敵出現順は固定で、
逃走・情報カード表示・戦闘後アイテムメニューは未対応です。
実機のタイミング入力は「通常／強打」の選択に置き換えています。
異常に長い戦闘には無限ループ防止の決着処理があります。
そのため、現状をすべての実機操作を正確に再現した完成版として扱わないでください。

## 商品情報

アソシエイト設定がある場合はAmazonでバーコードを検索し、識別番号が一致した商品の
名前とサムネイルを表示します。Amazonで解決できない場合はOpen Food Factsを検索します。
食品以外や未登録商品はバーコード番号のまま表示します。検索障害で対戦は中断しません。
Open Food Facts画像は許可した配信元から取得し、サイズ・形式を制限してR2にキャッシュします。
Amazonの商品画像はAmazonが返す画像URLを利用します。Amazon商品にはアフィリエイトリンクと
アフィリエイトを含まない商品ページリンクを併記します。
商品情報を表示する際は[Open Food Facts](https://world.openfoodfacts.org/)の
[データ利用条件](https://world.openfoodfacts.org/terms-of-use)
（データベースODbL、個別コンテンツDbCL、画像CC BY-SA）を確認してください。
外部サービスへの照会にバーコード番号を使用します。カメラ映像は使用しません。

## 運用上の注意

部屋の更新と対戦記録はD1の条件付き更新・トランザクションで処理します。
ゲームAPIは同一オリジンから利用してください。無料枠の上限と公開運用時のアクセス制限、
バックアップ、古い対戦履歴・セッション・レート制限データの削除方針は運用者が設定してください。
実機や参照元との差異は、再現バーコードと操作手順を添えて報告してください。