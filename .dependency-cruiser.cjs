/**
 * Import rules that keep the archive's promises structural.
 *
 * Several are about REACH, not direct imports (`reachable: true`): a rule that
 * only checks one hop passes while the reach exists two hops away, which is
 * how the legacy code base found out it needed a transitive check.
 *
 * Some rules name folders that do not exist yet (apps/api/src/lists,
 * apps/api/src/permissions). They are here so the workstream that creates
 * those folders starts inside the rule rather than adding it afterwards.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-unresolvable',
      comment:
        'An import the checker cannot resolve is an import none of these rules can see. ' +
        'Usually a workspace package used without being listed in package.json.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-packages-run-in-a-browser',
      comment:
        'packages/* run on the server and in the browser alike. A Node built-in here ' +
        "breaks the website, and for @reportlog/seal it breaks verification in the reader's browser.",
      severity: 'error',
      from: { path: '^packages/[^/]+/src' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'fields-never-reach-sealing',
      comment:
        'A list uses @reportlog/fields and must never be able to reach anything that ' +
        'writes to a chain. That is why fields lives apart from seal.',
      severity: 'error',
      from: { path: '^packages/fields/' },
      to: { path: '^(packages/seal/|@reportlog/seal$)', reachable: true },
    },
    {
      name: 'lists-never-reach-the-chain',
      comment:
        'An entry is not a report. Nothing under lists may reach the sealing code or the chain.',
      severity: 'error',
      from: { path: '^apps/api/src/lists/' },
      to: { path: '^(packages/seal/|apps/api/src/chain/)', reachable: true },
    },
    {
      name: 'revocable-permissions-stay-out-of-the-seal',
      comment:
        'A permission a reporter can take back must never be able to reach the fingerprint, ' +
        'or a report would verify differently because somebody changed their mind.',
      severity: 'error',
      from: { path: '^(packages/seal/|apps/api/src/chain/)' },
      to: { path: '^apps/api/src/permissions/', reachable: true },
    },
    {
      name: 'presentation-stays-out-of-the-seal',
      comment:
        "The site's name, look, wording and legal text are presentation, and the directory " +
        'and feedback are mutable state about people. A report must never verify differently ' +
        'because somebody renamed the site, an organization left the directory, or a tester filed an issue.',
      severity: 'error',
      from: { path: '^(packages/seal/|apps/api/src/chain/)' },
      to: { path: '^apps/api/src/(site|feedback)/', reachable: true },
    },
    {
      name: 'maps-stay-out-of-the-seal',
      comment:
        'A heat map is a view of the record, not part of it. A report must never verify ' +
        'differently because somebody changed a map.',
      severity: 'error',
      from: { path: '^(packages/seal/|apps/api/src/chain/)' },
      to: { path: '^apps/api/src/maps/', reachable: true },
    },
    {
      name: 'packages-do-not-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-does-not-import-the-server',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/api/' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts|json)$',
          '\\.d\\.ts$',
          '(^|/)(vite|vitest|playwright)\\.config\\.ts$',
          '\\.gen\\.ts$',
          '/(test|e2e)/',
          '^apps/api/src/(server|dev/seed|db/migrate-cli|db/gen-types)\\.ts$',
          '^apps/web/src/main\\.tsx$',
          // Found by the router plugin from the file name, not by an import.
          '^apps/web/src/routes/',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^legacy/|/dist/|routeTree\\.gen\\.ts$)' },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default', 'types'],
      extensions: ['.ts', '.tsx', '.js', '.json'],
    },
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
  },
};
