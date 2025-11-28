import { Handler, Context } from 'aws-lambda';
import { 
  TranslateClient, 
  StartTextTranslationJobCommand, 
  DescribeTextTranslationJobCommand 
} from '@aws-sdk/client-translate';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const translateClient = new TranslateClient({});
const s3Client = new S3Client({});

export const handler: Handler = async (event, context: Context) => {
  const { s3Key, targetLang, jobId, action } = event.arguments;
  const bucketName = process.env.STORAGE_DOCUMENTBUCKET_BUCKETNAME;
  const dataAccessRoleArn = process.env.TRANSLATE_ROLE_ARN;

  if (!bucketName || !dataAccessRoleArn) {
    throw new Error('Configuration missing (Bucket or Role ARN)');
  }

  try {
    // --- ACTION: START ---
    if (action === 'start') {
      console.log(`Starting Job for: ${s3Key} to ${targetLang}`);
      
      // 1. Vorab-Check: Existiert die Datei wirklich?
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Key }));
        console.log("File exists and is accessible by Lambda.");
      } catch (e: any) {
        console.error("S3 HeadObject failed:", e);
        throw new Error(`File not found or not accessible: ${s3Key}. Error: ${e.message}`);
      }

      const inputUri = `s3://${bucketName}/${s3Key}`;
      const outputUri = `s3://${bucketName}/translated/`;
      const jobName = `job-${Date.now()}`;

      // Dateityp Bestimmung
      const lowerKey = s3Key.toLowerCase();
      let inputDataConfig: any = { S3Uri: inputUri };

      // WICHTIG: Für PDF MUSS ContentType gesetzt sein.
      // Für DOCX lassen wir ihn WEG, damit AWS ihn automatisch erkennt (stabiler).
      if (lowerKey.endsWith('.pdf')) {
        inputDataConfig.ContentType = 'application/pdf';
      } 
      // Kein ContentType für .docx setzen!

      console.log(`Input Config:`, JSON.stringify(inputDataConfig));

      const command = new StartTextTranslationJobCommand({
        JobName: jobName,
        InputDataConfig: inputDataConfig,
        OutputDataConfig: { S3Uri: outputUri },
        DataAccessRoleArn: dataAccessRoleArn,
        SourceLanguageCode: 'auto',
        TargetLanguageCodes: [targetLang]
      });

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