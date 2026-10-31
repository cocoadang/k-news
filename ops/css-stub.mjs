// Test-only: lets Node import React components that import .css files (styles are irrelevant to server-side tests).
import { register } from 'node:module';
register('./css-stub-hooks.mjs', import.meta.url);
