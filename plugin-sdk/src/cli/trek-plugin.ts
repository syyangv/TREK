#!/usr/bin/env node
/** `trek-plugin <command>` dispatcher (#plugins, M6). Commands: validate. */
import { validatePluginDir } from './validate.js';

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'validate') {
  const r = validatePluginDir(rest[0] || '.');
  for (const w of r.warnings) console.warn('warning: ' + w);
  if (r.ok) {
    console.log('✓ plugin is valid');
  } else {
    for (const e of r.errors) console.error('error: ' + e);
    process.exit(1);
  }
} else {
  console.error('usage: trek-plugin validate [dir]');
  process.exit(2);
}
