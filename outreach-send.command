#!/bin/zsh
export PATH="$HOME/.nvm/versions/node/v24.13.1/bin:/opt/homebrew/bin:$PATH"
cd ~/event-hub-pipeline
node src/send-outreach.mjs
echo ""
echo "完了。何かキーを押すと閉じます..."
read -k 1
