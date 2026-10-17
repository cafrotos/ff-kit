import path from 'node:path'

/** Ship-test checkout of the whole workspace for a card: `<worktrees_dir>/<slug>.test/`. Not a card worktree. */
export const TEST_DIR_SUFFIX = '.test'
export const isTestDirName = (name) => typeof name === 'string' && name.endsWith(TEST_DIR_SUFFIX)
export const testDirPath = (root, worktreesDir, slug) => path.resolve(root, worktreesDir, `${slug}${TEST_DIR_SUFFIX}`)
export const testRepoDir = (root, worktreesDir, slug, repo) => path.join(testDirPath(root, worktreesDir, slug), path.basename(repo.path))
