import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseHtml } from '../src/dom.js';

export const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');
export const doc = (name: string) => parseHtml(fixture(name));
