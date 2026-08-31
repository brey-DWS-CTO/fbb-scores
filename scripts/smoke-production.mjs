const productionUrl = (process.env.PRODUCTION_URL ?? 'https://fbb-scores.dowhatsolutions.com').replace(/\/$/, '')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function get(path) {
  const response = await fetch(`${productionUrl}${path}`, {
    headers: { 'user-agent': 'fbb-scores-production-smoke/1.0' },
  })
  assert(response.ok, `${path} returned ${response.status}`)
  return response
}

const homeResponse = await get('/')
const homeHtml = await homeResponse.text()
assert(homeHtml.includes('<div id="root">'), 'Production HTML is missing the React root')
assert(/\/assets\/index-[^"']+\.js/.test(homeHtml), 'Production HTML is missing a built JavaScript asset')

const keeperResponse = await get('/keepers/Joel')
const keeperHtml = await keeperResponse.text()
assert(keeperHtml.includes('<div id="root">'), 'SPA rewrite failed for /keepers/Joel')

const stateResponse = await get('/api/league/state')
const stateResult = await stateResponse.json()
assert(stateResult && typeof stateResult === 'object', 'League state is not a JSON object')
assert(stateResult.state && typeof stateResult.state === 'object', 'League state payload is missing state')
assert(stateResult.state.season === 2027, `Expected season 2027, got ${String(stateResult.state.season)}`)

console.log(`Production smoke passed: ${productionUrl}`)
