# Start here / 最初にお読みください

## English
Use this archive as the working repository in Claude Code. Read the delivery boundary in README before implementation. Paste `CLAUDE_CODE_JOB.md` as the initial job; Claude must read `CLAUDE.md` and each mandatory document before editing. Approve your organization identifiers, licensed SDK access, Apple account and infrastructure through normal project configuration. Never paste production secrets into a prompt.

Review every screen in `design/screens.json`. Open the visual gallery through the local server; standalone PNGs are available without tools. There is one normal presentation per catalog screen per language/theme, plus explicit loading/empty/error/denied requirements. Secondary responsive sizes and Dynamic Type require implementation tests; they are not represented as separate PNGs.

Run the reference API using the README commands. Add a camera record, enroll staff, upload a photo, add a manually observed incident, acknowledge it, record an outcome and search the past record. These verify the workflow, not ML performance. Install the edge service on a physical store LAN to test discovery and stream integration during implementation.

## 日本語
このZIPをClaude Codeの作業フォルダとして開いてください。最初にREADMEの実装範囲を確認し、`CLAUDE_CODE_JOB.md`を初回指示として渡してください。Claudeは`CLAUDE.md`と必須資料を読み、工程ごとの検証を完了してから先へ進みます。

WebとiOSの全画面設計は`design/screens.json`に定義されています。各画面について日本語・英語、ライト・ダークのPNGを同梱しています。読み込み中・空の状態・通信エラー・権限不足の仕様も定義しています。別の端末サイズや文字サイズは実装時に検証してください。

付属の参照アプリでは、カメラ情報登録、スタッフ・対象者登録、写真登録、手動の事案記録、対応開始、確認結果入力、過去記録検索を実行できます。この参照アプリに学習済み万引き検知や顔認証の実機能は含まれません。実際の検知はライセンス済みSDK、学習済みモデル、店舗映像での評価が必要です。

クラウドから店舗LANのONVIF機器を直接探索できるとは限りません。店舗内エッジ端末で検索・RTSP取得・解析を実施し、外向きの暗号化通信でサーバーと接続してください。
