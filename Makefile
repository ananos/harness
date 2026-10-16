PY := python3 -I
REPORTS := $(HOME)/.claude/harness/reports
TODAY := $(shell date +%Y-%m-%d)
MONTH_AGO := $(shell date -v-30d +%Y-%m-%d)

.PHONY: test agent-gate install install-apply uninstall uninstall-apply sweep metrics

test agent-gate:
	@$(PY) bin/gate

install:
	@$(PY) bin/install.py

install-apply:
	@$(PY) bin/install.py --apply

uninstall:
	@$(PY) bin/install.py --uninstall

uninstall-apply:
	@$(PY) bin/install.py --uninstall --apply

sweep:
	@mkdir -p $(REPORTS)
	@$(PY) lints/memory_freshness.py | tee $(REPORTS)/memory-$(TODAY).md

metrics:
	@$(PY) metrics/baseline.py --since $(MONTH_AGO) --until $(TODAY)
