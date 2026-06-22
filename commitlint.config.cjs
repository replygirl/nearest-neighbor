// commitlint.config.cjs — extends @commitlint/config-conventional with nearest-neighbor overrides
// See CONTRIBUTING.md "Commit format" for documentation on valid types and scopes.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'chore',
        'docs',
        'style',
        'refactor',
        'test',
        'perf',
        'ci',
        'build',
        'revert',
      ],
    ],
    'scope-enum': [
      2,
      'always',
      [
        // Apps
        'api',
        'web',
        // Packages
        'db',
        'analytics',
        'api-types',
        // Tooling
        'cli',
        'claude-plugin',
        'codex-plugin',
        // Cross-cutting
        'infra',
        'ci',
        'docs',
        'dev',
        'agents',
        'hooks',
        'deps',
        'test',
        'chore',
      ],
    ],
    'subject-max-length': [2, 'always', 72],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
    'body-max-line-length': [2, 'always', 100],
  },
}
