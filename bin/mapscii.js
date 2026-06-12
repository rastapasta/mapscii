#!/usr/bin/env node

process.env.TERM ||= 'xterm-256color';

await import('../dist/main.js');
