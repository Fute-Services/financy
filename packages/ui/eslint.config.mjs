import { createReactConfig } from '@financy/config/eslint/react';

export default createReactConfig({
  tsconfigRootDir: import.meta.dirname,
  project: './tsconfig.json',
});
