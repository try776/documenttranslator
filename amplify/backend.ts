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

// 1. Unauthenticated Identities (Gäste) erlauben
(backend.auth.resources.cfnResources.cfnIdentityPool as any).allowUnauthenticatedIdentities = true;

// 2. IAM Service-Rolle für Amazon Translate erstellen
// Diese Rolle wird von Amazon Translate "angenommen" (assumed), um auf S3 und Textract zuzugreifen.
const translateServiceRole = new Role(backend.createStack('TranslateRoleStack'), 'TranslateServiceRole', {
  assumedBy: new ServicePrincipal('translate.amazonaws.com'),
});

// 3. S3 Berechtigungen für die Translate Rolle
// Translate muss Input lesen und Output schreiben können
translateServiceRole.addToPolicy(new PolicyStatement({
  actions: [
    's3:GetObject',
    's3:ListBucket',
    's3:PutObject',
    's3:GetBucketLocation' // Wichtig für Cross-Region Checks interner Art
  ],
  resources: [
    backend.storage.resources.bucket.bucketArn,
    `${backend.storage.resources.bucket.bucketArn}/*`
  ],
}));

// 4. Textract Berechtigungen für die Translate Rolle (ZWINGEND FÜR PDF)
translateServiceRole.addToPolicy(new PolicyStatement({
  actions: [
    'textract:DetectDocumentText',
    'textract:AnalyzeDocument'
  ],
  resources: ['*'],
}));

// 5. Lambda Konfiguration
// Wir übergeben den ARN der Rolle an die Lambda
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'STORAGE_DOCUMENTBUCKET_BUCKETNAME',
  backend.storage.resources.bucket.bucketName
);
(backend.translateFunction.resources.lambda as any).addEnvironment(
  'TRANSLATE_ROLE_ARN',
  translateServiceRole.roleArn
);

// 6. Lambda Rechte
// Lambda muss die Translate-Jobs starten und die Rolle an Translate "übergeben" (PassRole) dürfen.
backend.translateFunction.resources.lambda.addToRolePolicy(new PolicyStatement({
  actions: [
    'translate:StartTextTranslationJob', 
    'translate:DescribeTextTranslationJob',
    'iam:PassRole' // WICHTIG: Erlaubt Lambda, die translateServiceRole an den Job zu hängen
  ],
  resources: ['*'],
}));

// S3 Zugriff für Lambda selbst (um Ergebnisse zu prüfen oder URLs zu generieren)
backend.storage.resources.bucket.grantReadWrite(backend.translateFunction.resources.lambda);