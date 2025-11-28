import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';
import { data } from './data/resource';
import { translateFunction } from './functions/translate/resource';
import { PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';

const backend = defineBackend({
  auth,
  storage,
  data,
  translateFunction,
});

// 1. Gast-Zugriff für S3 und API
(backend.auth.resources.cfnResources.cfnIdentityPool as any).allowUnauthenticatedIdentities = true;

// 2. IAM Service-Rolle für Amazon Translate
const translateServiceRole = new Role(backend.createStack('TranslateRoleStack'), 'TranslateServiceRole', {
  assumedBy: new ServicePrincipal('translate.amazonaws.com'),
});

// S3 Zugriff: Read/Write und explizit ListBucket (wichtig für Batch Jobs)
backend.storage.resources.bucket.grantReadWrite(translateServiceRole);
translateServiceRole.addToPolicy(new PolicyStatement({
  actions: ['s3:ListBucket', 's3:GetBucketLocation'],
  resources: [backend.storage.resources.bucket.bucketArn]
}));

// Textract Zugriff: Wir geben '*' um Permission-Probleme auszuschließen
translateServiceRole.addToPolicy(new PolicyStatement({
  actions: ['textract:*'], 
  resources: ['*'],
}));

// 3. Lambda Konfiguration
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'STORAGE_DOCUMENTBUCKET_BUCKETNAME',
  backend.storage.resources.bucket.bucketName
);
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'TRANSLATE_ROLE_ARN',
  translateServiceRole.roleArn
);

// Lambda Rechte um den Job zu steuern
backend.translateFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: [
    'translate:StartTextTranslationJob', 
    'translate:DescribeTextTranslationJob',
    'iam:PassRole'
  ],
  resources: ['*'],
}));

// Lambda S3 Zugriff
backend.storage.resources.bucket.grantReadWrite(backend.translateFunction.resources.lambda);