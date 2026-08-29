import { createBaseConfig } from './index.js';

/**
 * Node / NestJS packages.
 *
 * @param {{ tsconfigRootDir: string; project?: string | string[] }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createNodeConfig(options) {
  return [
    ...createBaseConfig({ ...options, browser: false }),
    {
      rules: {
        // NestJS relies on parameter decorators and property injection, which
        // the base rules would otherwise flag.
        '@typescript-eslint/parameter-properties': 'off',
        '@typescript-eslint/no-extraneous-class': 'off',
        // Controllers and services are classes with decorators; `this` aliasing
        // rules add noise without value here.
        '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],
      },
    },
  ];
}

export default createNodeConfig;
