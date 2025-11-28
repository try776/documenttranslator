// amplify/backend.ts
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';
import { data } from './data/resource';
import { translateFunction } from './functions/translate/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({
  auth,
  storage,
  data,
  translateFunction,
});

// --- FIX FÜR GAST ZUGRIFF ---
// Erzwingt, dass unauthentifizierte Benutzer (Gäste) erlaubt sind.
const { cfnIdentityPool } = backend.auth.resources.cfnResources;
cfnIdentityPool.allowUnauthenticatedIdentities = true;

// --- LAMBDA BERECHTIGUNGEN ---

// 1. Bucket Name an Lambda übergeben
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