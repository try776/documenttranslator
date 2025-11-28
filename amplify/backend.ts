import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';
import { translateFunction } from './functions/translate/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({
  auth,
  storage,
  translateFunction,
});

// --- PERMISSIONS ---

// 1. Zugriff der Lambda auf den S3 Bucket (Read/Write)
// Der Bucket-Name wird als Env-Variable an die Lambda übergeben
backend.translateFunction.resources.lambda.addEnvironment(
  'STORAGE_DOCUMENTBUCKET_BUCKETNAME',
  backend.storage.resources.bucket.bucketName
);

// Rechte für S3 Operationen
const s3Policy = new PolicyStatement({
  actions: ['s3:GetObject', 's3:PutObject'],
  resources: [
    backend.storage.resources.bucket.bucketArn,
    `${backend.storage.resources.bucket.bucketArn}/*`
  ],
});
backend.translateFunction.resources.lambda.addToRolePolicy(s3Policy);

// 2. Rechte für Amazon Translate
const translatePolicy = new PolicyStatement({
  actions: ['translate:TranslateDocument'],
  resources: ['*'], // Translate Service ist nicht ressourcengebunden in diesem Kontext
});
backend.translateFunction.resources.lambda.addToRolePolicy(translatePolicy);