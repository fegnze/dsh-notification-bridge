import { request } from '../src/client.js'
try {
  const operation = process.argv[2] || 'status'
  const input = operation === 'send' ? JSON.parse(process.argv[3] === '--stdin' ? await new Promise((resolve, reject) => {
    let body = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { body += chunk; if (body.length > 16384) { reject(new Error('input too large')); process.stdin.destroy() } });
    process.stdin.on('end', () => resolve(body)); process.stdin.on('error', reject)
  }) : process.argv[3] || '{}') : {}
  console.log(JSON.stringify(await request(operation, input, { timeoutMs: operation === 'authorize' ? 120000 : 10000 })))
} catch (error) { console.error(error.message); process.exitCode = 1 }
