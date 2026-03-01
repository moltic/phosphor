#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dialsJs = readFileSync(new URL('../ui/dials.js', import.meta.url), 'utf8');
const styleCss = readFileSync(new URL('../style.css', import.meta.url), 'utf8');

const placeholderRuleMatch = styleCss.match(/\.dial-drag-placeholder\s*\{([\s\S]*?)\n\}/);
assert(placeholderRuleMatch, 'Missing .dial-drag-placeholder rule in style.css');

const placeholderRule = placeholderRuleMatch[1];
assert(!/pointer-events:\s*none\s*;/.test(placeholderRule), '.dial-drag-placeholder must not disable pointer events');
assert(/pointer-events:\s*auto\s*;/.test(placeholderRule), '.dial-drag-placeholder should explicitly allow pointer events');

assert(
  /_dragPlaceholder\.addEventListener\('drop'/.test(dialsJs),
  'Drag placeholder should handle drop events directly',
);
assert(
  /_dragPlaceholder\.style\.pointerEvents\s*=\s*'auto'/.test(dialsJs),
  'Drag placeholder should enforce pointer events in JS as a fallback',
);
assert(
  /async function _commitPlaceholderDrop\(fromAlias\)/.test(dialsJs),
  'Drag/drop should persist from a placeholder-aware commit helper',
);
assert(
  /const _DRAG_REORDER_SELECTOR = '\.dial-tile, \.dial-divider, \.dial-group-header';/.test(dialsJs),
  'Divider nodes should participate in the shared drag/reorder selector',
);
assert(
  /!child\.classList\.contains\('dial-tile'\)\s*&&\s*!child\.classList\.contains\('dial-divider'\)/.test(dialsJs),
  'Placeholder snapshots should preserve divider aliases alongside tiles',
);
assert(
  !/_getNewOrderFromPlaceholder/.test(dialsJs),
  'Legacy flat-array placeholder reorder helper should not remain in use',
);
assert(
  /if \(await _commitPlaceholderDrop\(fromAlias\)\)/.test(dialsJs),
  'Tile/body/grid drop handlers should all prefer the placeholder commit path',
);
assert(
  /\.dial-section-body\.dial-section-body--has-divider/.test(styleCss),
  'Auto layout should provide a divider-friendly section-body fallback',
);
assert(
  /toggle-divider/.test(dialsJs),
  'Divider context menu should expose an in-place row/column toggle',
);

console.log('dial-dnd-contract.test.js: OK');
