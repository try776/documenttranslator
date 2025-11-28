import { defineFunction } from '@aws-amplify/backend';

export const translateFunction = defineFunction({
  name: 'translate-document',
  entry: './handler.ts',
  timeoutSeconds: 60, // Dokumentübersetzung kann kurz dauern
  runtime: 20
});