// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { decodePolicy } from './core/policy';
import { mountProfessor } from './ui/professor';
import { mountStudent } from './ui/student';

const root = document.getElementById('app') as HTMLElement;
if (location.hash.startsWith('#ask=')) {
  const policy = decodePolicy(location.hash.slice(1));
  document.title = policy?.professor ? `Letter request: ${policy.professor}` : 'Letter request';
  mountStudent(root, policy);
} else {
  void mountProfessor(root);
}
// The professor's "Preview as a student" opens the link in a new tab; a hash change in place (pasting a link) reloads into the right view.
window.addEventListener('hashchange', () => location.reload());
