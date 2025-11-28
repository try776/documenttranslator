// amplify/data/resource.ts
import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { translateFunction } from '../functions/translate/resource';

const schema = a.schema({
  translateDocument: a.query()
    .arguments({
      s3Key: a.string().required(),
      targetLang: a.string().required()
    })
    .returns(a.json()) // Wir geben ein JSON Objekt zurück
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