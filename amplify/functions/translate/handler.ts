import { Handler } from 'aws-lambda';
import { TranslateClient, TranslateDocumentCommand } from '@aws-sdk/client-translate';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// Initialisierung der Clients außerhalb des Handlers (Performance)
const translateClient = new TranslateClient({});
const s3Client = new S3Client({});

// Hilfsfunktion: Stream zu Buffer konvertieren
const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

export const handler: Handler = async (event) => {
  // Parsing des Bodies, da Aufruf über API Gateway/Lambda Proxy kommt
  const body = event.body ? JSON.parse(event.body) : event;
  const { s3Key, targetLang } = body;

  console.log(JSON.stringify({ 
    level: 'INFO', 
    message: 'Lambda Started', 
    s3Key, 
    targetLang 
  }));

  const bucketName = process.env.STORAGE_DOCUMENTBUCKET_BUCKETNAME;
  if (!bucketName) {
    console.error(JSON.stringify({ level: 'ERROR', message: 'Bucket Name env missing' }));
    return { statusCode: 500, body: JSON.stringify({ error: 'Server Configuration Error' }) };
  }

  try {
    // 1. Original PDF von S3 holen
    console.log(JSON.stringify({ level: 'INFO', message: 'Fetching object from S3', bucket: bucketName, key: s3Key }));
    const getCommand = new GetObjectCommand({ Bucket: bucketName, Key: s3Key });
    const s3Item = await s3Client.send(getCommand);

    if (!s3Item.Body) throw new Error('Empty S3 Body');
    const fileBuffer = await streamToBuffer(s3Item.Body as Readable);

    // 2. An Amazon Translate senden (Real-time Document Translation)
    console.log(JSON.stringify({ level: 'INFO', message: 'Invoking Amazon Translate', targetLang }));
    const translateCommand = new TranslateDocumentCommand({
      Document: {
        Content: fileBuffer,
        ContentType: 'application/pdf'
      },
      SourceLanguageCode: 'auto',
      TargetLanguageCode: targetLang
    });

    const result = await translateClient.send(translateCommand);
    
    if (!result.TranslatedDocument || !result.TranslatedDocument.Content) {
      throw new Error('Translation failed: No content returned');
    }

    // 3. Übersetztes PDF zurück in S3 speichern
    const originalName = s3Key.split('/').pop();
    const newKey = `translated/translated-${originalName}`;
    
    console.log(JSON.stringify({ level: 'INFO', message: 'Saving result to S3', newKey }));
    
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: newKey,
      Body: result.TranslatedDocument.Content,
      ContentType: 'application/pdf'
    }));

    console.log(JSON.stringify({ level: 'INFO', message: 'Job completed successfully' }));

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
    console.error(JSON.stringify({ 
      level: 'ERROR', 
      message: 'Processing Failed', 
      error: error.message, 
      stack: error.stack 
    }));
    
    return {
      statusCode: 500,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "*"
      },
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};