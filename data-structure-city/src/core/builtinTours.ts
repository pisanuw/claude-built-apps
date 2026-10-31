import type { Tour } from './tours';

export const BUILTIN_TOURS: Tour[] = [
  {
    title: 'Watch a rehash',
    stops: [
      {
        say: 'The hash map starts with 4 buckets and rehashes when the load factor (entries / buckets) would pass 0.75. We insert three keys.',
        run: ['SET apple 1', 'SET pear 2', 'SET fig 3'],
        question: {
          prompt: 'Three keys in four buckets is a load factor of 0.75. What happens on the fourth SET?',
          choices: ['It joins a chain; nothing else changes', 'The table doubles to 8 buckets and every entry moves', 'The oldest key is evicted'],
          answer: 1,
          explain: '4 / 4 = 1.0 > 0.75, so the map allocates 8 buckets and re-inserts every entry. Eviction is what a cache does, not a map.',
        },
      },
      {
        say: 'Here comes the fourth key. Look at the hash map cost meter: this one SET is much more expensive than the others.',
        run: ['SET plum 4'],
      },
      {
        say: 'Now fill in 12 more keys. Watch the worst-case number and the amortized average on the hash map meter.',
        run: ['FILL 12'],
        question: {
          prompt: 'After many inserts, is the average (amortized) cost per SET closer to the cheap ones or the rehash spikes?',
          choices: ['Closer to the cheap ones', 'Closer to the spikes', 'It keeps growing with n'],
          answer: 0,
          explain: 'Doubling means each rehash pays for itself over the inserts since the last one, so the average stays a small constant even though single SETs spike.',
        },
      },
    ],
  },
  {
    title: 'B-tree splits and merges',
    stops: [
      {
        say: 'This B-tree has minimum degree 2, so a node holds 1 to 3 keys (a 2-3-4 tree). Insert three keys into the single root node.',
        run: ['SET 10 a', 'SET 20 b', 'SET 30 c'],
        question: {
          prompt: 'The root is full with [10 20 30]. Where does the middle key go when we insert 40?',
          choices: ['It stays; 40 goes into a new right child', '20 moves up into a new root, and the tree grows a level', '10 is evicted'],
          answer: 1,
          explain: 'A full node splits before the insert descends into it: the median moves up. Splitting the root is the only way a B-tree gets taller, which keeps every leaf at the same depth.',
        },
      },
      { say: 'Insert 40 and watch the root split.', run: ['SET 40 d'] },
      {
        say: 'Insert a few more so a leaf fills up and splits again, pushing another key into the root.',
        run: ['SET 50 e', 'SET 60 f', 'SET 70 g'],
      },
      {
        say: 'Now delete keys. A node that would drop below 1 key first borrows from a sibling or merges with it.',
        run: ['DEL 10', 'DEL 20'],
        question: {
          prompt: 'When a deletion leaves only one key in the root and its children merge, what happens to the height?',
          choices: ['It stays the same', 'It can shrink by one level', 'It grows'],
          answer: 1,
          explain: 'If a merge pulls the last key out of the root, the root becomes empty and its only child becomes the new root.',
        },
      },
      { say: 'Delete more and look for merge and shrink events in the narration.', run: ['DEL 30', 'DEL 40', 'DEL 50'] },
    ],
  },
  {
    title: 'LRU eviction',
    stops: [
      {
        say: 'The LRU cache has 5 slots. The front is the most recently used entry. Fill it.',
        run: ['SET a 1', 'SET b 2', 'SET c 3', 'SET d 4', 'SET e 5'],
      },
      {
        say: 'Read "a", the oldest entry. A hit moves it to the front.',
        run: ['GET a'],
        question: {
          prompt: 'Now we SET f. Which key gets evicted?',
          choices: ['a', 'b', 'e'],
          answer: 1,
          explain: 'GET a made a the most recent, so b is now the least recently used entry at the tail.',
        },
      },
      { say: 'Insert f.', run: ['SET f 6'] },
      {
        say: 'Ask for b. The hash map, B-tree and skip list all still have it: only the cache forgot.',
        run: ['GET b'],
      },
    ],
  },
  {
    title: 'Skip list towers and range queries',
    seed: 7,
    stops: [
      {
        say: 'Each new skip-list key flips coins: every heads adds a level. Tall towers act as express lanes for searches.',
        run: ['FILL 12'],
        question: {
          prompt: 'About what fraction of keys should reach level 2 or higher?',
          choices: ['About 1/2', 'About 1/4', 'All of them'],
          answer: 0,
          explain: 'With p = 1/2, each key reaches level 2 with probability 1/2, level 3 with 1/4, and so on. This seed is fixed, so your city matches everyone else’s.',
        },
      },
      {
        say: 'Range queries need order. Compare the cost meters for this RANGE.',
        run: ['RANGE k3 k6'],
        question: {
          prompt: 'Which building pays the most for RANGE k3 k6?',
          choices: ['B-tree', 'Skip list', 'Hash map'],
          answer: 2,
          explain: 'The hash map and LRU keep no key order, so they must visit every entry. The B-tree and skip list jump to k3 and walk forward.',
        },
      },
    ],
  },
  {
    title: 'Time to live',
    stops: [
      {
        say: 'Keys can expire. Set one with EX and give another an EXPIRE.',
        run: ['SET session abc EX 3', 'SET user ana', 'EXPIRE user 5', 'TTL session'],
      },
      {
        say: 'Advance the clock 3 ticks.',
        run: ['TICK 3'],
        question: {
          prompt: 'Which keys are still in the city after TICK 3?',
          choices: ['session and user', 'only user', 'neither'],
          answer: 1,
          explain: 'session was set to expire at tick 3 and is swept from every building; user lasts until tick 5.',
        },
      },
      { say: 'Two more ticks.', run: ['TICK 2', 'KEYS'] },
    ],
  },
];
