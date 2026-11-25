#!/bin/sh
# 파일 버전 번호를 새로 붙이고 깃허브에 올려요: sh tools/deploy.sh "메시지"
cd "$(dirname "$0")/.." || exit 1
V=$(date +%m%d%H%M%S)
sed -i -E "s#(href|src)=\"(theme\.css|config\.js|common\.js|main\.js)(\?v=[0-9]+)?\"#\1=\"\2?v=$V\"#g" *.html
node --check common.js && node --check main.js || exit 1
git add -A && git commit -qm "$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" && git push -q
for i in $(seq 1 30); do curl -s "https://v1234vs1-creator.github.io/event-gauge-demo/index.html?x=$i$V" | grep -q "v=$V" && { echo "live $V"; exit 0; }; sleep 5; done
echo "아직 반영 안 됨"
