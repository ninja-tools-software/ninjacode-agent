import { BILLING_TOKEN } from './tokens.js';
export function charge() { return BILLING_TOKEN.slice(0, 8); }
