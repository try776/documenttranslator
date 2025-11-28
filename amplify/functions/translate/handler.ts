import { Handler } from 'aws-lambda';
import { TranslateClient, TranslateDocumentCommand } from '@aws-sdk/client-translate';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

// WICHTIG: Region explizit auf Frankfurt (eu-central-1) setzen
const translateClient = new TranslateClient({ region: "eu-central-1" });
const s3Client = new S3Client({}); // S3 nutzt die lokale Region (sa-east-1)

const streamToBuffer = async (stream: Readable): Promise<Buffer> => {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
};

export const handler: Handler = async (event) => {
  // Argumente sicher abrufen
  const args = event.arguments || {};
  const { s3Key, targetLang } = args;

  console.log(JSON.stringify({ level: 'INFO', message: 'Lambda Started', s3Key, targetLang }));

  const bucketName = process.env.STORAGE_DOCUMENTBUCKET_BUCKETNAME;
  if (!bucketName) {
    console.error("Bucket Name Env missing");
    throw new Error('Server Configuration Error: Bucket missing');
  }

  try {
    // 1. Datei von S3 laden
    console.log(`Fetching from S3 bucket: ${bucketName} key: ${s3Key}`);
    const getCommand = new GetObjectCommand({ Bucket: bucketName, Key: s3Key });
    const s3Item = await s3Client.send(getCommand);
    
    if (!s3Item.Body) throw new Error('Empty S3 Body');
    
    // Datei in Speicher laden (Hier wird RAM benötigt!)
    const fileBuffer = await streamToBuffer(s3Item.Body as Readable);
    console.log(`File loaded. Size: ${fileBuffer.length} bytes`);

    // 2. An Amazon Translate senden
    console.log(`Sending to Amazon Translate (eu-central-1). Target: ${targetLang}`);
    const translateCommand = new TranslateDocumentCommand({
      Document: { Content: fileBuffer, ContentType: 'application/pdf' },
      SourceLanguageCode: 'auto',
      TargetLanguageCode: targetLang
    });
    
    const result = await translateClient.send(translateCommand);
    
    if (!result.TranslatedDocument?.Content) {
      throw new Error('Translation failed: No content returned from Amazon Translate');
    }
    console.log('Translation received.');

    // 3. Ergebnis speichern
    const originalName = s3Key.split('/').pop();
    const newKey = `translated/translated-${originalName}`;
    
    console.log(`Saving result to S3: ${newKey}`);
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: newKey,
      Body: result.TranslatedDocument.Content,
      ContentType: 'application/pdf'
    }));

    console.log('Success.');
    return {
      status: 'DONE',
      downloadPath: newKey,
      fileName: `translated-${originalName}`
    };

  } catch (error: any) {
    console.error("Lambda Error Details:", JSON.stringify(error, Object.getOwnPropertyNames(error)));
    // Fehler zurückgeben, damit das Frontend ihn anzeigen kann
    return { status: 'ERROR', error: error.message || 'Unknown Server Error' };
  }
};