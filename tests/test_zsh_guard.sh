#!/bin/bash
# The zsh guard fixes the three silent zsh traps in the tool shell, and
# leaves other zsh invocations alone.
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd -P)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/claude/shell-snapshots"
echo ': snapshot' >"$tmp/claude/shell-snapshots/s.sh"
echo "source '$root/hooks/zshenv-guard.zsh'" >"$tmp/.zshenv"

# shellcheck disable=SC2016 # expanded by the zsh under test
probe='x="a b"; set -- $x; echo "words=$#"; echo ==; ls -d /nonexistent*x 2>/dev/null; echo "glob_rc=$?"'
tool="source $tmp/claude/shell-snapshots/s.sh; $probe"

fail=0
expect() {
	if [ "$2" != "$3" ]; then
		echo "FAIL $1: got [$2] want [$3]"
		fail=1
	else
		echo "ok   $1"
	fi
}

out=$(ZDOTDIR="$tmp" CLAUDECODE=1 /bin/zsh -c "$tool" 2>&1 || true)
expect "tool shell splits words" "$(echo "$out" | grep words=)" "words=2"
expect "tool shell keeps ==" "$(echo "$out" | sed -n 2p)" "=="
expect "tool shell passes unmatched glob" "$(echo "$out" | grep glob_rc)" "glob_rc=1"

out=$(env -u CLAUDECODE ZDOTDIR="$tmp" /bin/zsh -c "$tool" 2>&1 || true)
expect "no CLAUDECODE: zsh semantics" "$(echo "$out" | grep words= || true)" "words=1"

out=$(ZDOTDIR="$tmp" CLAUDECODE=1 /bin/zsh -c "$probe" 2>&1 || true)
expect "plain zsh -c: zsh semantics" "$(echo "$out" | grep words= || true)" "words=1"

exit "$fail"
