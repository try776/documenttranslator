import { Handler, Context } from 'aws-lambda';
import { 
  TranslateClient, 
  StartTextTranslationJobCommand, 
  DescribeTextTranslationJobCommand 
} from '@aws-sdk/client-translate';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

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

  // LOG zur Überprüfung, ob der neue Code läuft
  console.log("HANDLER_VERSION: V2_FIXED_FOLDER");

  if (!bucketName || !dataAccessRoleArn) {
    throw new Error('Configuration missing (Bucket or Role ARN)');
  }

  try {
    if (action === 'start') {
      console.log(`Starting Job for File: ${s3Key}`);
      
      const fileExists = await waitForFile(bucketName, s3Key);
      if (!fileExists) {
        throw new Error(`NO_FILE_FOUND: File ${s3Key} did not appear in S3.`);
      }

      // WICHTIG: Pfad zum Ordner extrahieren!
      // s3Key: uploads/12345/MyFile.docx
      // inputPrefix: uploads/12345/
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

      console.log(`Using Input Folder URI: ${inputUri}`); // Das muss in den Logs stehen!

      const command = new StartTextTranslationJobCommand({
        JobName: jobName,
        InputDataConfig: { 
          S3Uri: inputUri, // Zeigt auf Ordner
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

    if (action === 'check') {
      const command = new DescribeTextTranslationJobCommand({ JobId: jobId });
      const res = await translateClient.send(command);
      const jobProps = res.TextTranslationJobProperties;
      const status = jobProps?.JobStatus;
      
      console.log(`Job Check: ${jobId} Status: ${status}`);

      if (status === 'COMPLETED') {
        const accountId = context.invokedFunctionArn.split(':')[4];
        const usedLang = jobProps?.TargetLanguageCodes?.[0] || targetLang;
        const outputFolder = `${accountId}-${jobId}-${usedLang}`;
        const finalPath = `translated/${outputFolder}/${s3Key}`;

        return { 
          status: 'DONE', 
          downloadPath: finalPath,
          fileName: s3Key.split('/').pop() 
        };

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