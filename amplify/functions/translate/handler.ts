import { Handler } from 'aws-lambda';
import { TranslateClient, TranslateDocumentCommand } from '@aws-sdk/client-translate';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Clients initialisieren (AWS SDK v3)
const translateClient = new TranslateClient({});
const s3Client = new S3Client({});

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

export const handler: Handler = async (event) => {
  const { s3Key, targetLang, action } = event.arguments || event.body ? JSON.parse(event.body) : event;
  
  // CloudWatch Log Start
  console.log(JSON.stringify({ 
    level: 'INFO', 
    message: 'Lambda triggered', 
    action, 
    s3Key, 
    targetLang 
  }));

  if (!process.env.STORAGE_DOCUMENTBUCKET_BUCKETNAME) {
    throw new Error('Bucket Name Env Variable missing');
  }
  const bucketName = process.env.STORAGE_DOCUMENTBUCKET_BUCKETNAME;

  try {
    // 1. Datei von S3 holen
    console.log(JSON.stringify({ level: 'INFO', message: 'Fetching file from S3', bucket: bucketName, key: s3Key }));
    
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    });
    const s3Item = await s3Client.send(getCommand);
    
    if (!s3Item.Body) {
      throw new Error('No body in S3 object');
    }

    const fileBuffer = await streamToBuffer(s3Item.Body as Readable);

    // 2. Amazon Translate aufrufen (Synchronous Document Translation)
    console.log(JSON.stringify({ level: 'INFO', message: 'Calling Amazon Translate', targetLang }));
    
    const translateCommand = new TranslateDocumentCommand({
      Document: {
        Content: fileBuffer,
        ContentType: 'application/pdf'
      },
      SourceLanguageCode: 'auto',
      TargetLanguageCode: targetLang
    });

    const translationResult = await translateClient.send(translateCommand);
    
    if (!translationResult.TranslatedDocument || !translationResult.TranslatedDocument.Content) {
      throw new Error('Translation returned empty content');
    }

    // 3. Ergebnis zurück in S3 speichern
    // Wir ändern den Pfad von 'uploads/...' zu 'translated/...'
    const originalName = s3Key.split('/').pop();
    const newKey = `translated/translated-${originalName}`;

    console.log(JSON.stringify({ level: 'INFO', message: 'Uploading result to S3', newKey }));

    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: newKey,
      Body: translationResult.TranslatedDocument.Content,
      ContentType: 'application/pdf'
    });

    await s3Client.send(putCommand);

    console.log(JSON.stringify({ level: 'INFO', message: 'Process completed successfully' }));

    // Rückgabe für Frontend
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
      },
      body: JSON.stringify({
        status: 'DONE',
        downloadPath: newKey,
        fileName: `translated-${originalName}`
      })
    };

  } catch (error: any) {
    console.error(JSON.stringify({ level: 'ERROR', message: 'Translation failed', error: error.message, stack: error.stack }));
    
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
      },
      body: JSON.stringify({
        status: 'ERROR',
        error: error.message
      })
    };
  }
};