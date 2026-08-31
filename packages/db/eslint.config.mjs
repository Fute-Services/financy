import { createNodeConfig } from '@financy/config/eslint/node';

/**
 * `@financy/db` is the one package permitted to import `@prisma/client`
 * directly — the base config bans it everywhere else so that Prisma stays
 * behind a repository (ADR-0003, docs/08 §4.3). The exemption is declared here
 * rather than as a global escape hatch, so the ban keeps holding elsewhere.
 *
 * Everything else in the base config still applies, including the BullMQ ban.
 */
export default [
  ...createNodeConfig({
    tsconfigRootDir: import.meta.dirname,
    project: './tsconfig.json',
  }),
  {
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'bullmq',
              message:
                'bullmq may only be imported by BullMqQueueAdapter, so the codebase stays runnable without Redis. See ADR-0006.',
            },
          ],
        },
      ],
    },
  },
];
