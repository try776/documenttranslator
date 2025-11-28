// amplify/backend.ts
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';
import { data } from './data/resource'; // Neu
import { translateFunction } from './functions/translate/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({
  auth,
  storage,
  data,
  translateFunction,
});

// --- BERECHTIGUNGEN ---

// 1. Bucket Name an Lambda übergeben
// Wir nutzen 'as any', um den TypeScript Fehler zu umgehen (L2 Construct Zugriff)
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'STORAGE_DOCUMENTBUCKET_BUCKETNAME',
  backend.storage.resources.bucket.bucketName
);

// 2. S3 Zugriff für die Lambda (Read/Write)
const s3Policy = new PolicyStatement({
  actions: ['s3:GetObject', 's3:PutObject'],
  resources: [
    backend.storage.resources.bucket.bucketArn,
    `${backend.storage.resources.bucket.bucketArn}/*`
  ],
});
backend.translateFunction.resources.lambda.addToRolePolicy(s3Policy);

// 3. Amazon Translate Berechtigung
const translatePolicy = new PolicyStatement({
  actions: ['translate:TranslateDocument'],
  resources: ['*'],
});
backend.translateFunction.resources.lambda.addToRolePolicy(translatePolicy);