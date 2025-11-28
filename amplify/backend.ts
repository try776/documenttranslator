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

// FIX: Gast-Zugriff erzwingen
(backend.auth.resources.cfnResources.cfnIdentityPool as any).allowUnauthenticatedIdentities = true;

// 1. IAM Service-Rolle für Amazon Translate erstellen
const translateServiceRole = new Role(backend.createStack('TranslateRoleStack'), 'TranslateServiceRole', {
  assumedBy: new ServicePrincipal('translate.amazonaws.com'),
});

// Zugriff auf Bucket gewähren (S3)
backend.storage.resources.bucket.grantReadWrite(translateServiceRole);

// WICHTIG: Zugriff auf Textract gewähren! 
// Ohne dies schlägt PDF-Übersetzung mit "Invalid ContentType" fehl.
translateServiceRole.addToPolicy(new PolicyStatement({
  actions: [
    'textract:DetectDocumentText', 
    'textract:AnalyzeDocument'
  ],
  resources: ['*'],
}));

// 2. Lambda Konfiguration
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'STORAGE_DOCUMENTBUCKET_BUCKETNAME',
  backend.storage.resources.bucket.bucketName
);
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'TRANSLATE_ROLE_ARN',
  translateServiceRole.roleArn
);

// 3. Lambda Rechte
backend.translateFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: [
    'translate:StartTextTranslationJob', 
    'translate:DescribeTextTranslationJob',
    'iam:PassRole'
  ],
  resources: ['*'],
}));

backend.storage.resources.bucket.grantReadWrite(backend.translateFunction.resources.lambda);