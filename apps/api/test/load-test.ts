import autocannon from 'autocannon';

interface TestConfig {
  name: string;
  url: string;
  method?: 'GET' | 'POST';
  duration?: number;
  connections?: number;
  pipelining?: number;
  headers?: Record<string, string>;
  body?: string;
  expectedMinRps?: number;
  expectedMaxP95Ms?: number;
}

const BASE_URL = process.env.API_URL || 'http://localhost:3001';
const DURATION = parseInt(process.env.LOAD_TEST_DURATION || '10', 10);

const scenarios: TestConfig[] = [
  {
    name: 'GET /health Baseline Load Test',
    url: `${BASE_URL}/health`,
    method: 'GET',
    duration: DURATION,
    connections: 50,
    pipelining: 1,
    expectedMinRps: 100,
    expectedMaxP95Ms: 200,
  },
  {
    name: 'GET /feed Query Load Test',
    url: `${BASE_URL}/feed`,
    method: 'GET',
    duration: DURATION,
    connections: 20,
    pipelining: 1,
    expectedMinRps: 10,
    expectedMaxP95Ms: 500,
  },
  {
    name: 'GET /articles Listing Load Test',
    url: `${BASE_URL}/articles`,
    method: 'GET',
    duration: DURATION,
    connections: 20,
    pipelining: 1,
    expectedMinRps: 10,
    expectedMaxP95Ms: 500,
  },
  {
    name: 'Throttler / Rate Limit Gate Test',
    url: `${BASE_URL}/health`,
    method: 'GET',
    duration: 5,
    connections: 100,
    pipelining: 2,
  },
];

async function runScenario(scenario: TestConfig): Promise<boolean> {
  console.log(`\n==================================================`);
  console.log(`Running Scenario: ${scenario.name}`);
  console.log(`URL: ${scenario.url} (${scenario.method || 'GET'})`);
  console.log(`Connections: ${scenario.connections}, Duration: ${scenario.duration}s`);
  console.log(`==================================================`);

  return new Promise((resolve) => {
    const instance = autocannon({
      url: scenario.url,
      method: scenario.method || 'GET',
      connections: scenario.connections || 10,
      duration: scenario.duration || 10,
      pipelining: scenario.pipelining || 1,
      headers: scenario.headers,
      body: scenario.body,
    });

    autocannon.track(instance, { renderProgressBar: false });

    instance.on('done', (result) => {
      console.log(`\n📊 Results for ${scenario.name}:`);
      console.log(`   Requests/sec (RPS): ${result.requests.average.toFixed(2)}`);
      console.log(`   Latency Average:    ${result.latency.average.toFixed(2)} ms`);
      console.log(`   Latency P50:        ${result.latency.p50} ms`);
      console.log(`   Latency P95:        ${result.latency.p95} ms`);
      console.log(`   Latency P99:        ${result.latency.p99} ms`);
      console.log(`   Total Requests:     ${result.requests.total}`);
      console.log(`   2xx Successes:      ${result['2xx']}`);
      console.log(`   4xx Rate Limits:    ${result['4xx']}`);
      console.log(`   5xx Errors:         ${result['5xx']}`);
      console.log(`   Non-2xx Responses:  ${result.non2xx}`);

      let passed = true;
      if (result['5xx'] > 0) {
        console.error(`❌ FAILED: Received ${result['5xx']} 5xx server errors!`);
        passed = false;
      }

      if (scenario.expectedMinRps && result.requests.average < scenario.expectedMinRps) {
        console.warn(
          `⚠️ WARNING: RPS (${result.requests.average.toFixed(2)}) below target threshold of ${scenario.expectedMinRps}`,
        );
      }

      if (scenario.expectedMaxP95Ms && result.latency.p95 > scenario.expectedMaxP95Ms) {
        console.warn(
          `⚠️ WARNING: P95 Latency (${result.latency.p95}ms) exceeded target threshold of ${scenario.expectedMaxP95Ms}ms`,
        );
      }

      resolve(passed);
    });
  });
}

async function main() {
  console.log(`🚀 Starting Inferr API Load Test Suite`);
  let allPassed = true;

  for (const scenario of scenarios) {
    const passed = await runScenario(scenario);
    if (!passed) {
      allPassed = false;
    }
  }

  console.log(`\n==================================================`);
  if (allPassed) {
    console.log(`✅ All load test scenarios completed cleanly with 0 server errors.`);
    process.exit(0);
  } else {
    console.error(`❌ Load test suite completed with failures/errors.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal load test error:', err);
  process.exit(1);
});
