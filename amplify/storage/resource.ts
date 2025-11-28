import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'documentBucket',
  access: (allow) => ({
    'uploads/*': [
      allow.guest.to(['write', 'read']),
      allow.authenticated.to(['write', 'read'])
    ],
    'translated/*': [
      allow.guest.to(['read', 'write']),
      allow.authenticated.to(['read', 'write'])
    ]
  })
});