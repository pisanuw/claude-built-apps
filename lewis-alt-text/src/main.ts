/**
 * Mounts the page with the real dependencies: the HintWise sign-in, the
 * template's ask() (HintWise key or the visitor's own key) and the browser's
 * canvas for resizing. Everything else is in src/ui/app.ts.
 */
import './ui/styles.css';
import skill from '../skill/lewis-structure-alt-text-v8.txt?raw';
import type { Generate } from './core/alt-text';
import { currentToken, mountSignIn, onAuth } from './lib/auth';
import { ask, gatewayUrl, textOf, type MessageParam } from './lib/llm';
import { hasSupabase } from './lib/supabase';
import { checkAllowance } from './ui/allowance';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

const live = hasSupabase();

const generate: Generate = async (req) => {
  const msg = await ask({ system: req.system, messages: req.messages as MessageParam[], model: req.model, max_tokens: req.max_tokens });
  return { text: textOf(msg), model: msg.model, stopReason: msg.stop_reason, usage: msg.usage };
};

mountApp(root, {
  skill,
  generate,
  live,
  mountSignIn: live ? (el) => void mountSignIn(el) : undefined,
  onAuth: live ? (cb) => void onAuth(() => cb()) : undefined,
  checkAllowance: live ? () => checkAllowance({ url: gatewayUrl(), getToken: () => currentToken() }) : undefined,
});
