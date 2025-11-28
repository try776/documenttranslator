import { defineFunction } from '@aws-amplify/backend';

export const translateFunction = defineFunction({
  name: 'translate-document',
  entry: './handler.ts',
  timeoutSeconds: 300, // 5 Minuten Zeit lassen
  memoryMB: 3012,       // WICHTIG: Mehr RAM für PDF Verarbeitung (Standard ist zu wenig)
  runtime: 20
});