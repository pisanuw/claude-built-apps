/**
 * The checker's address in deploy/target.yml, as the host tests expect it
 * (AC-13). Milestone 4b is released in two steps (DECISIONS.md D-133):
 * step 1 deploys backend-hub with the checker mounted while the app keeps
 * calling the free worker; step 2, once the live hub's checker answers
 * compile: true, points the app at the hub. Step 2's commit changes this
 * file and that one line of deploy/target.yml, and nothing else.
 */
export const CHECKER_ADDRESS = 'https://tagging-doctor-worker.onrender.com';
/** The address the app does not call in this step. */
export const NOT_CALLED = 'https://backend-hub-wk2e.onrender.com/tagging-doctor';
