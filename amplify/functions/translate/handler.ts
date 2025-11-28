import { Handler, Context } from 'aws-lambda';
import { 
  TranslateClient, 
  StartTextTranslationJobCommand, 
  DescribeTextTranslationJobCommand 
} from '@aws-sdk/client-translate';

const translateClient = new TranslateClient({ region: "eu-central-1" });

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

      const command = new StartTextTranslationJobCommand({
        JobName: jobName,
        InputDataConfig: { 
          S3Uri: inputUri,
          ContentType: 'application/pdf'
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

      if (status === 'COMPLETED') {
        // Pfad zusammenbauen: s3://bucket/translated/ACCOUNT-JOBID-LANG/inputKey
        // Wir brauchen die Account ID aus dem Context
        const accountId = context.invokedFunctionArn.split(':')[4];
        
        // Amazon Translate Output Struktur:
        // outputUri + accountId-JobId-TargetLang + / + originalS3Key
        // Achtung: s3Key enthält bereits "uploads/...", das wird beibehalten.
        
        // Wir konstruieren den Pfad relativ zum Bucket root für 'getUrl'
        // Folder Name Format: accountId-JobId-TargetLanguageCode
        // Aber TargetLanguageCode im Folder ist oft klein oder groß? AWS nutzt den Code vom Input.
        // Wir holen ihn aus den JobProps sicherheitshalber
        const usedLang = jobProps?.TargetLanguageCodes?.[0] || targetLang;
        
        const outputFolder = `${accountId}-${jobId}-${usedLang}`;
        const finalPath = `translated/${outputFolder}/${s3Key}`;

        return { 
          status: 'DONE', 
          downloadPath: finalPath,
          fileName: s3Key.split('/').pop() 
        };

      } else if (status === 'FAILED' || status === 'COMPLETED_WITH_ERROR') {
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