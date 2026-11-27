// Writes the seccomp profile the spike ran Chromium's sandbox under: Docker's
// default profile (github.com/moby/profiles, seccomp/default.json) with one
// rule added, allowing the namespace calls Chromium's sandbox makes as an
// unprivileged user (clone with namespace flags, unshare, setns). Docker's
// default allows them only with CAP_SYS_ADMIN.
//   node make-seccomp.mjs <default.json> <out.json>
import fs from 'node:fs';
const [src, out] = process.argv.slice(2);
const profile = JSON.parse(fs.readFileSync(src, 'utf8'));
profile.syscalls.push({ names: ['clone', 'unshare', 'setns'], action: 'SCMP_ACT_ALLOW', comment: 'heard-as-check spike: Chromium namespace sandbox' });
fs.writeFileSync(out, JSON.stringify(profile, null, 2));
