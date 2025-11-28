import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { translateFunction } from '../functions/translate/resource';

const schema = a.schema({
  translateDocument: a.query()
    .arguments({
      s3Key: a.string(),       // Pfad zur Datei (optional bei Check)
      targetLang: a.string(),  // Sprache (optional bei Check)
      jobId: a.string(),       // Job ID (für Check)
      action: a.string()       // 'start' oder 'check'
    })
    .returns(a.json())
    .authorization(allow => [allow.guest(), allow.authenticated()])
    .handler(a.handler.function(translateFunction))
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'iam',
  },
});