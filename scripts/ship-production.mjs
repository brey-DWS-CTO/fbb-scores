import { execFileSync, spawnSync } from 'node:child_process'

function read(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

function run(command, args) {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', command, ...args], { stdio: 'inherit' })
    : spawnSync(command, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const branch = read('git', ['branch', '--show-current'])
if (branch !== 'master') {
  throw new Error(`Production ships only from master; current branch is ${branch || '(detached HEAD)'}`)
}

if (read('git', ['status', '--porcelain'])) {
  throw new Error('Commit or stash every change before shipping production')
}

run('npm', ['run', 'check'])

if (read('git', ['status', '--porcelain'])) {
  throw new Error('The release checks changed tracked files; review and commit them before shipping')
}

run('git', ['push', 'origin', 'master'])
run('vercel', ['deploy', '--prod', '--yes'])
run('npm', ['run', 'smoke:prod'])
