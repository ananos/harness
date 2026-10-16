# Sourced from ~/.zshenv. The Claude Code Bash tool runs /bin/zsh -c with a
# shell snapshot; give that shell (and only that shell) the bash behaviour
# agents write for: unmatched globs pass through, `=word` is literal, and
# unquoted $var splits on whitespace. zsh scripts and interactive shells
# are untouched.
if [[ -n ${CLAUDECODE-} && ! -o interactive \
	&& ${ZSH_EXECUTION_STRING-} == *claude/shell-snapshots/* ]]; then
	setopt no_nomatch no_equals sh_word_split
fi
