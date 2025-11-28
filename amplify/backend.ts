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
// Diese Rolle erlaubt Translate, Dateien von S3 zu lesen und zu schreiben
const translateServiceRole = new Role(backend.createStack('TranslateRoleStack'), 'TranslateServiceRole', {
  assumedBy: new ServicePrincipal('translate.amazonaws.com'),
});

// Zugriff auf Bucket gewähren
backend.storage.resources.bucket.grantReadWrite(translateServiceRole);

// 2. Lambda Konfiguration
// Wir übergeben den ARN der Rolle an die Lambda, damit sie den Job damit starten kann
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'STORAGE_DOCUMENTBUCKET_BUCKETNAME',
  backend.storage.resources.bucket.bucketName
);
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'TRANSLATE_ROLE_ARN',
  translateServiceRole.roleArn
);

// 3. Lambda Rechte
// Lambda darf Jobs starten/prüfen und die Rolle an Translate "weiterreichen" (PassRole)
backend.translateFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: [
    'translate:StartTextTranslationJob', 
    'translate:DescribeTextTranslationJob',
    'iam:PassRole'
  ],
  resources: ['*'],
}));

// Lambda darf auch S3 nutzen (optional für Checks)
backend.storage.resources.bucket.grantReadWrite(backend.translateFunction.resources.lambda);