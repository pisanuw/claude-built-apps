/**
 * Entry point: mounts the checker with a repository for the client file.
 * Until sign-in lands (milestone 2) the file lives in this tab only.
 */
import './styles.css';
import type { ClientFile } from './core/clientFile';
import { InMemoryRepository, newId } from './lib/repository';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');

void mountApp(root, { repo: new InMemoryRepository<ClientFile>(), newId });
