// The live app's public sign-in values, read from deploy/target.yml so there
// is one copy. Public by design (the anon key only reaches what row level
// security allows); no secret is read or stored here.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'deploy', 'target.yml');

export function hintwiseConfig(file = TARGET) {
  const text = readFileSync(file, 'utf8');
  const get = (key) => text.match(new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm'))?.[1];
  const supabaseUrl = process.env.LEWIS_SUPABASE_URL || get('VITE_SUPABASE_URL');
  const anonKey = process.env.LEWIS_SUPABASE_ANON_KEY || get('VITE_SUPABASE_ANON_KEY');
  if (!supabaseUrl || !anonKey) throw new Error(`could not read the HintWise sign-in settings from ${file}`);
  return { supabaseUrl, anonKey };
}
