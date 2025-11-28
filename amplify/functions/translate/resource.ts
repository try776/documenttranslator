import { defineFunction } from '@aws-amplify/backend';

export const translateFunction = defineFunction({
  name: 'translate-document',
  entry: './handler.ts',
  timeoutSeconds: 300, // 5 Minuten Timeout für größere Dokumente
  runtime: 20
});