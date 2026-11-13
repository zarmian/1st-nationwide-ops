#!/usr/bin/env bash
# Installs Playwright and its Chromium for the portal robots. Every robot
# workflow runs this straight after checkout.
#
# The runner's package mirror sometimes stalls. On 11 Nov 2026 apt-get hung for
# 44 minutes inside "playwright install --with-deps" until GitHub's job time
# limit cancelled the run, and nothing synced. So each try now gets 5 minutes
# (a normal install takes under one). If the full install doesn't work, the
# second try fetches only the browser: GitHub's Ubuntu image already has the
# system libraries Chromium needs, because it ships Google Chrome.
#
# The robot workflows run on ubuntu-24.04 rather than ubuntu-latest, which is
# moving to Ubuntu 26: this Playwright version wasn't built for that, and its
# list of system packages may not install there.
set -u

npm init -y >/dev/null 2>&1 || true
npm install playwright@1.48.0 || exit 1

timeout --kill-after=20 300 npx playwright install --with-deps chromium
status=$?
if [ "$status" -eq 0 ]; then
  exit 0
fi
if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
  echo "The browser install took more than 5 minutes. Trying again with just the browser."
else
  echo "The browser install failed (exit $status). Trying again with just the browser."
fi
timeout --kill-after=20 300 npx playwright install chromium
