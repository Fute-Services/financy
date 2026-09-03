import { createNodeConfig } from '@financy/config/eslint/node';

export default createNodeConfig({
  tsconfigRootDir: import.meta.dirname,
  project: './tsconfig.json',
});
