import { createBaseConfig } from './index.js';

/**
 * React / Next.js packages.
 *
 * The `no-money-arithmetic` rules below are the mechanised form of the single
 * most important frontend guarantee in this product: no financial figure is
 * ever computed in the browser (docs/15-REPORTING-ANALYTICS.md §1, ADR-0013).
 * A client-side sum is unauditable, scope-blind, and will drift between
 * components — and in a system whose purpose is answering "how much did we
 * spend?", a number nobody can reproduce is worse than no number.
 *
 * @param {{ tsconfigRootDir: string; project?: string | string[] }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createReactConfig(options) {
  return [
    ...createBaseConfig({ ...options, browser: true }),
    {
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: [
              {
                name: 'decimal.js',
                message:
                  'Money arithmetic must not happen in the browser. Request a server-computed figure instead. See docs/15-REPORTING-ANALYTICS.md §1 and ADR-0013.',
              },
              {
                name: '@prisma/client',
                message: 'The frontend never talks to the database. Use the API client.',
              },
            ],
          },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: "NewExpression[callee.name='Decimal']",
            message:
              'Money arithmetic must not happen in the browser. The server sends computed figures; the browser formats them. See ADR-0013.',
          },
          {
            selector:
              'CallExpression[callee.property.name=/^(add|subtract|minus|plus|times|dividedBy)$/][callee.object.name=/[Mm]oney|[Aa]mount|[Tt]otal/]',
            message:
              'Money arithmetic must not happen in the browser. Request a server-computed total. See ADR-0013.',
          },
          {
            selector: 'JSXAttribute[name.name="dangerouslySetInnerHTML"]',
            message:
              'dangerouslySetInnerHTML is prohibited — user content is never rendered as HTML. See THR-13.',
          },
        ],
      },
    },
  ];
}

export default createReactConfig;
