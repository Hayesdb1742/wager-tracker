import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Not our code, and gitignored, so nothing here can ever ship: `.agents`
    // holds vendored third-party skill packages that `npx skills update`
    // overwrites, and `.claude/worktrees` holds full checkouts of src from
    // agent sessions. Linting them produced 544 errors against 0 in src/, and
    // the stale worktree copies actively mislead -- a fixed file keeps
    // reporting its old error from the copy.
    ".agents/**",
    ".claude/**",
  ]),
]);

export default eslintConfig;
