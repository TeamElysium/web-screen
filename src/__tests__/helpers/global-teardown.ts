import { execSync } from 'child_process'

let output = ''
try {
  output = execSync('screen -ls 2>&1').toString()
} catch (err: unknown) {
  if (err && typeof err === 'object' && 'stdout' in err) {
    output = (err as { stdout: Buffer }).stdout.toString()
  }
}

let killed = 0
for (const line of output.split('\n')) {
  if (line.includes('wst_')) {
    const match = line.match(/\t(\d+)\./)
    if (match) {
      try {
        execSync(`kill -9 ${match[1]} 2>&1`)
        killed++
      } catch { /* */ }
    }
  }
}

if (killed > 0) {
  execSync('sleep 1')
  try { execSync('screen -wipe 2>&1') } catch { /* */ }
}
