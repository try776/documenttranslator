import { Handler, Context } from 'aws-lambda';
import { 
  TranslateClient, 
  StartTextTranslationJobCommand, 
  DescribeTextTranslationJobCommand 
} from '@aws-sdk/client-translate';

// Client nutzt die Region der Lambda (eu-central-1)
const translateClient = new TranslateClient({});

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
      
      const inputUri = `s3://${bucketName}/${s3Key}`;
      const outputUri = `s3://${bucketName}/translated/`;
      const jobName = `job-${Date.now()}`;

      // Dateityp dynamisch erkennen
      const lowerKey = s3Key.toLowerCase();
      let contentType = 'application/octet-stream'; // Fallback

      if (lowerKey.endsWith('.pdf')) {
        contentType = 'application/pdf';
      } else if (lowerKey.endsWith('.docx')) {
        // Der offizielle MIME-Type für .docx
        contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      }

      console.log(`Detected ContentType: ${contentType}`);

      const command = new StartTextTranslationJobCommand({
        JobName: jobName,
        InputDataConfig: { 
          S3Uri: inputUri,
          ContentType: contentType
        },
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