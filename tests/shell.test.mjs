import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tokenize, segments, stripHeredocs, commandBinaries, headTokens } from '../scripts/lib/shell.mjs'

test('tokenize tôn trọng nháy, kể cả nháy giữa token và \\" trong nháy kép', () => {
  assert.deepEqual(tokenize(`git commit -m "a b" 'c d'`), ['git', 'commit', '-m', 'a b', 'c d'])
  assert.deepEqual(tokenize(`FOO="a b" yarn build`), ['FOO=a b', 'yarn', 'build'])
  assert.deepEqual(tokenize('echo "x\\"y"'), ['echo', 'x"y'])
})

test('segments tách theo && | ; xuống dòng, không tách >&, &>, 2>&1', () => {
  assert.deepEqual(segments(`cd a && echo "x;y" | grep x; ls`), ['cd a', 'echo "x;y"', 'grep x', 'ls'])
  assert.deepEqual(segments(`yarn build 2>&1 | tee x`), ['yarn build 2>&1', 'tee x'])
  assert.deepEqual(segments(`make &> log`), ['make &> log'])
})

test('stripHeredocs bỏ thân heredoc', () => {
  assert.equal(stripHeredocs(`cat <<'EOF'\ngit push\nEOF\nls`), `cat <<'EOF'\nls`)
})

test('headTokens bỏ ( đầu subshell và tiền tố env/sudo', () => {
  assert.deepEqual(headTokens('(cd web '), ['cd', 'web'])
  assert.deepEqual(headTokens('sudo FOO=1 make x'), ['make', 'x'])
})

test('headTokens skips wrapper flags and their operands', () => {
  assert.deepEqual(headTokens('/usr/bin/env -u TOKEN -- /usr/bin/git push'), ['/usr/bin/git', 'push'])
  assert.deepEqual(headTokens('sudo -n -u root -- /usr/bin/git stash'), ['/usr/bin/git', 'stash'])
  assert.deepEqual(headTokens('command -p -- git push'), ['git', 'push'])
  assert.deepEqual(headTokens('timeout --signal=TERM 5s git push'), ['git', 'push'])
  assert.deepEqual(headTokens("env -S 'git push'"), ['git', 'push'])
})

test('commandBinaries bỏ builtin, subshell, redirect', () => {
  assert.deepEqual(commandBinaries('cd web && FOO=1 yarn build && sudo make x'), ['yarn', 'make'])
  assert.deepEqual(commandBinaries('export NODE_ENV=test && yarn test'), ['yarn'])
  assert.deepEqual(commandBinaries('source .venv/bin/activate && pytest'), ['pytest'])
  assert.deepEqual(commandBinaries('. ./env.sh; set -e; make test'), ['make'])
  assert.deepEqual(commandBinaries('(cd web && yarn build)'), ['yarn'])
  assert.deepEqual(commandBinaries('FOO="a b" yarn build'), ['yarn'])
  assert.deepEqual(commandBinaries('yarn build 2>&1 | tee x'), ['yarn', 'tee'])
  assert.deepEqual(commandBinaries('if [ -f x ]; then make; fi'), ['make'])
  assert.deepEqual(commandBinaries('for d in a b; do yarn --cwd $d build; done'), ['yarn'])
  assert.deepEqual(commandBinaries('! grep -q x f'), ['grep'])
})
