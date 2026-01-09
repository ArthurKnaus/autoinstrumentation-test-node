const Sentry = require('@sentry/node');

Sentry.init({
  dsn: 'https://ca30b85fea679faa253b9656308a78eb@o4509089275772928.ingest.de.sentry.io/4510539027447888',
  tracesSampleRate: 1.0,
});

