PY := python3 -I
REPORTS := $(HOME)/.claude/harness/reports
TODAY := $(shell date +%Y-%m-%d)
MONTH_AGO := $(shell date -v-30d +%Y-%m-%d)

.PHONY: test agent-gate install install-apply install-all install-all-apply uninstall uninstall-apply sweep metrics new-workflow

test agent-gate:
	@$(PY) bin/gate

install:
	@$(PY) bin/install.py

install-apply:
	@$(PY) bin/install.py --apply

install-all:
	@$(PY) bin/install.py --all

install-all-apply:
	@$(PY) bin/install.py --all --apply

uninstall:
	@$(PY) bin/install.py --uninstall

uninstall-apply:
	@$(PY) bin/install.py --uninstall --apply

sweep:
	@mkdir -p $(REPORTS)
	@$(PY) lints/memory_freshness.py | tee $(REPORTS)/memory-$(TODAY).md

metrics:
	@$(PY) metrics/baseline.py --since $(MONTH_AGO) --until $(TODAY)

new-workflow:
	@test -n "$(NAME)" || { echo "usage: make new-workflow NAME=my-flow"; exit 2; }
	@test ! -e workflows/$(NAME).js || { echo "workflows/$(NAME).js exists"; exit 1; }
	@sed 's/__NAME__/$(NAME)/g' templates/workflow.js > workflows/$(NAME).js
	@echo "created workflows/$(NAME).js; add tests/workflows/test_$(NAME).mjs"
