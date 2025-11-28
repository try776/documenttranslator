import { Handler, Context } from 'aws-lambda';
import { 
  TranslateClient, 
  StartTextTranslationJobCommand, 
  DescribeTextTranslationJobCommand 
} from '@aws-sdk/client-translate';
import { 
  S3Client, 
  HeadObjectCommand,
  ListObjectsV2Command 
} from '@aws-sdk/client-s3';

const translateClient = new TranslateClient({});
const s3Client = new S3Client({});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const waitForFile = async (bucket: string, key: string, maxRetries = 5) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      console.log(`File found after attempt ${i + 1}`);
      return true;
    } catch (e) {
      console.log(`File not found yet (Attempt ${i + 1}/${maxRetries}). Waiting...`);
      await delay(1000 * (i + 1)); 
    }
  }
  return false;
};

export const handler: Handler = async (event, context: Context) => {
  const { s3Key, targetLang, jobId, action } = event.arguments;
  const bucketName = process.env.STORAGE_DOCUMENTBUCKET_BUCKETNAME;
  const dataAccessRoleArn = process.env.TRANSLATE_ROLE_ARN;

  console.log("HANDLER_VERSION: V3_VALIDATED_PATH_SEARCH");

  if (!bucketName || !dataAccessRoleArn) {
    throw new Error('Configuration missing (Bucket or Role ARN)');
  }

  try {
    // --- ACTION: START ---
    if (action === 'start') {
      console.log(`Starting Job for File: ${s3Key}`);
      
      const fileExists = await waitForFile(bucketName, s3Key);
      if (!fileExists) {
        throw new Error(`NO_FILE_FOUND: File ${s3Key} did not appear in S3.`);
      }

      // Input Prefix extrahieren
      const lastSlashIndex = s3Key.lastIndexOf('/');
      const inputPrefix = s3Key.substring(0, lastSlashIndex + 1); 
      
      const inputUri = `s3://${bucketName}/${inputPrefix}`;
      const outputUri = `s3://${bucketName}/translated/`;
      const jobName = `job-${Date.now()}`;

      // ContentType Bestimmung
      const lowerKey = s3Key.toLowerCase();
      let finalContentType = 'application/octet-stream'; 

      if (lowerKey.endsWith('.pdf')) {
        finalContentType = 'application/pdf';
      } else if (lowerKey.endsWith('.docx')) {
        finalContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }

      const command = new StartTextTranslationJobCommand({
        JobName: jobName,
        InputDataConfig: { 
          S3Uri: inputUri, 
          ContentType: finalContentType 
        },
        OutputDataConfig: { S3Uri: outputUri },
        DataAccessRoleArn: dataAccessRoleArn,
        SourceLanguageCode: 'auto',
        TargetLanguageCodes: [targetLang]
      });

      console.log("Sending Command:", JSON.stringify(command));
      const res = await translateClient.send(command);
      return { status: 'JOB_STARTED', jobId: res.JobId };
    }

    // --- ACTION: CHECK ---
    if (action === 'check') {
      const command = new DescribeTextTranslationJobCommand({ JobId: jobId });
      const res = await translateClient.send(command);
      const jobProps = res.TextTranslationJobProperties;
      const status = jobProps?.JobStatus;
      
      console.log(`Job Check: ${jobId} Status: ${status}`);

      if (status === 'COMPLETED') {
        const usedLang = jobProps?.TargetLanguageCodes?.[0] || targetLang;
        
        // Dateinamen extrahieren (ohne Pfad)
        const originalFileName = s3Key.split('/').pop();
        // AWS Translate Schema: "lang.filename"
        const expectedFileName = `${usedLang}.${originalFileName}`;

        console.log(`Searching for file ending in: ${expectedFileName} containing JobId: ${jobId}`);

        // STATT ZU RATEN: Wir suchen die Datei im S3
        // Wir listen den Inhalt von "translated/" auf
        const listCommand = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: 'translated/'
        });

        const listRes = await s3Client.send(listCommand);
        
        // Finde den exakten Key
        // 1. Muss Teil des JobIds im Pfad haben (Sicherheit)
        // 2. Muss mit dem erwarteten Dateinamen enden
        const foundObject = listRes.Contents?.find(obj => 
          obj.Key && 
          obj.Key.includes(jobId) && 
          obj.Key.endsWith(expectedFileName)
        );

        if (foundObject && foundObject.Key) {
          console.log(`File found confirmed: ${foundObject.Key}`);
          return { 
            status: 'DONE', 
            downloadPath: foundObject.Key, // Der echte, validierte Pfad
            fileName: expectedFileName 
          };
        } else {
          // Fallback, falls Datei noch nicht sichtbar (S3 Eventual Consistency)
          console.warn("Job completed but file not found in ListObjects yet.");
          return { status: 'PROCESSING', jobStatus: 'FINALIZING_FILE' };
        }

      } else if (status === 'FAILED' || status === 'COMPLETED_WITH_ERROR') {
        console.error('Job Failed Details:', JSON.stringify(jobProps));
        return { status: 'ERROR', error: jobProps?.Message || 'Translation Job Failed' };
      } else {
        return { status: 'PROCESSING', jobStatus: status };
      }
    }

    return { status: 'ERROR', error: 'Invalid Action' };

  } catch (error: any) {
    console.error("Lambda Error:", error);
    return { status: 'ERROR', error: error.message };
  }
};