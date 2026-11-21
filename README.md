# asidestock

Claudeのチャット中に、複数の案や方針が提示された場合に自動でメモするパネルを生成するTampermonkeyユーザースクリプトです。

## 使い方

1. `prompts/preferences.ja.md` (英語環境の場合は `preferences.en.md` のほう) を、Claude の「設定 > マイ Claude > 指示」のテキストフィールドに入力します。
2. Chrome 拡張機能の Tampermonkey をセットアップします。Chrome の「拡張機能を管理」から Tampermonkey の「詳細」を開き、「ユーザー スクリプトを許可」をオンにしてください。
3. このリンク [asidestock.user.js をインストール](https://raw.githubusercontent.com/securecat/asidestock/main/userscripts/asidestock.user.js) を開いて Tampermonkey のインストール画面から「インストール」を押下します。（インストール後は、新しいバージョンが公開されると自動で更新されるようになります）
4. Claude とのチャット中に、複数の案や方針が提示されると自動でパネルの内容が更新されるようになります。

## 更新履歴

### [1.0.0] - 2026-11-21

#### 追加

- 初回リリース

全履歴は [CHANGELOG.md](CHANGELOG.md) を参照。
