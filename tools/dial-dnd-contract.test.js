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
  !/_getNewOrderFromPlaceholder/.test(dialsJs),
  'Legacy flat-array placeholder reorder helper should not remain in use',
);
assert(
  /if \(await _commitPlaceholderDrop\(fromAlias\)\)/.test(dialsJs),
  'Tile/body/grid drop handlers should all prefer the placeholder commit path',
);

console.log('dial-dnd-contract.test.js: OK');
