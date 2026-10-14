import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  defaultResource,
  resourceFromAttributes,
} from '@opentelemetry/resources';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// Optional: Enable OTel SDK diagnostic logging for troubleshooting in dev mode
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);

// Trace exporter pointing to our Jaeger/OTel Collector endpoint
// OpenTelemetry protocol over HTTP (default port 4318, path /v1/traces)
const traceExporter = new OTLPTraceExporter({
  url:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
    'http://localhost:4318/v1/traces',
});

// Create and merge default resource attributes with our specific service name
const resource = defaultResource().merge(
  resourceFromAttributes({
    'service.name': process.env.OTEL_SERVICE_NAME || 'ai-feed-api',
  }),
);

export const otelSDK = new NodeSDK({
  resource,
  traceExporter,
  // Jaeger only ingests traces, not OTLP metrics. Without this, the SDK's
  // default metric reader POSTs to /v1/metrics and logs OTLPExporterError: Not Found.
  metricReaders: [],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy filesystem tracing to keep trace telemetry clean
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
    }),
  ],
});

// Start the OpenTelemetry SDK immediately on import
console.log('Starting OpenTelemetry SDK...');
otelSDK.start();

// Gracefully shut down SDK on process exit
process.on('SIGTERM', () => {
  otelSDK
    .shutdown()
    .then(
      () => console.log('SDK shut down successfully'),
      (err) => console.log('Error shutting down SDK', err),
    )
    .finally(() => process.exit(0));
});
