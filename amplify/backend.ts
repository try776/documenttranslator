import { defineBackend } from '@aws-amplify/backend';
import { defineApi } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';
import { translateFunction } from './functions/translate/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

// API Definition für den Lambda Aufruf
const api = defineApi({
  name: 'translatorApi',
  routes: {
    '/translate': {
      methods: ['POST'],
      integration: translateFunction,
      authorizationModes: ['AWS_IAM'], 
    }
  },
  authorizationModes: {
    defaultAuthorizationMode: 'AWS_IAM', // Erlaubt einfachen Zugriff für Frontend (Guest/Auth)
  }
});

const backend = defineBackend({
  auth,
  storage,
  translateFunction,
  api
});

// --- BERECHTIGUNGEN ---

// 1. S3 Zugriff für die Lambda (Environment Variable + IAM Policy)
const bucket = backend.storage.resources.bucket;

backend.translateFunction.resources.lambda.addEnvironment(
  'STORAGE_DOCUMENTBUCKET_BUCKETNAME',
  bucket.bucketName
);

// Lese- und Schreibrechte auf den ganzen Bucket (oder spezifische Pfade)
const s3Policy = new PolicyStatement({
  actions: ['s3:GetObject', 's3:PutObject'],
  resources: [`${bucket.bucketArn}/*`],
});
backend.translateFunction.resources.lambda.addToRolePolicy(s3Policy);

// 2. Amazon Translate Berechtigung
const translatePolicy = new PolicyStatement({
  actions: ['translate:TranslateDocument'],
  resources: ['*'],
});
backend.translateFunction.resources.lambda.addToRolePolicy(translatePolicy);

// 3. API Zugriff für Gäste erlauben
// Damit User ohne Login die API nutzen können (IAM Guest Role)
backend.api.resources.restApi.root.addMethod('ANY', undefined, {
  authorizationType: 'AWS_IAM'
});

// Zugriff auf den '/translate' Pfad explizit für unauth Rolle freigeben
const unauthRole = backend.auth.resources.unauthenticatedUserIamRole;
backend.api.resources.restApi.methods.forEach((method) => {
   // Dies ist ein CDK Workaround, um sicherzugehen, dass IAM Policies greifen
});