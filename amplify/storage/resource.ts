import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
  name: 'documentBucket',
  access: (allow) => ({
    'uploads/*': [
      allow.guest.to(['write', 'read']),
      allow.authenticated.to(['write', 'read'])
    ],
    'translated/*': [
      allow.guest.to(['read', 'write']), // Write nötig, damit Lambda via SDK (als backend role) oder Client agieren kann, hier für Public Download
      allow.authenticated.to(['read', 'write'])
    ]
  })
});