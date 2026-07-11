# home-app プロジェクト設定

## 「ありがとう」ルール（最重要）

ユーザーが「ありがとう」と言ったら、**返答の冒頭で必ず**「「ありがとう」ルールを適用します。」と宣言し、以下を実行する:

1. このセッションで行った変更・発見・解決したバグを洗い出す
2. 該当するObsidianノートを更新する（直接ファイルに書き込む）:
   - 機能追加・変更 → `Projects/` の該当アプリノート
   - バグ解決・API発見 → `Knowledge/` に新規 or 追記
   - 設計判断 → `Decisions/`
3. 実行後に以下を明示して報告する:
   - 「Obsidian: ○○を更新しました」（更新したノートと内容）
   - 「デプロイ: このメッセージの送信でgit pushが自動実行されます」（フックが「ありがとう」を検知して自動デプロイ）

**Obsidianのパス**: `/Users/ryu_i/Desktop/obsidian/`

git push はフック（UserPromptSubmit hook）が自動で行うので、Claudeは実行しない。
フックは「ありがとう」を含むメッセージが送信された時点で実行される（Claudeの返答前）。

---

## プロジェクト概要

- **場所**: `/Users/ryu_i/Library/Mobile Documents/com~apple~CloudDocs/home-app/`
- **スタック**: Vanilla JS + Supabase + Netlify Functions
- **デプロイ**: GitHub main → Netlify 自動デプロイ
