"""No Docling/model inference needed: independent conversion-boundary regressions."""
import runpy
check = runpy.run_path('scripts/ai-extract.py')['conversion_complete']
assert check('success', [], [1, 2], 2)
assert not check('partial_success', [], [1, 2], 2)
assert not check('success', ['conversion failure'], [1, 2], 2)
assert not check('success', [], [1], 2)
assert not check('success', [], [1, 1], 2)
assert not check('failure', [], [], 2)
