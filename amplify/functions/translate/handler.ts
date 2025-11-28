import { Handler } from 'aws-lambda';
import { TranslateClient, TranslateDocumentCommand } from '@aws-sdk/client-translate';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

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
  const { s3Key, targetLang } = event.arguments;

  console.log(JSON.stringify({ level: 'INFO', message: 'Lambda Started', s3Key, targetLang }));

  const bucketName = process.env.STORAGE_DOCUMENTBUCKET_BUCKETNAME;
  if (!bucketName) {
    throw new Error('Bucket Name env missing');
  }

  try {
    // 1. Fetch
    console.log(JSON.stringify({ level: 'INFO', message: 'Fetching from S3', key: s3Key }));
    const getCommand = new GetObjectCommand({ Bucket: bucketName, Key: s3Key });
    const s3Item = await s3Client.send(getCommand);
    if (!s3Item.Body) throw new Error('Empty S3 Body');
    const fileBuffer = await streamToBuffer(s3Item.Body as Readable);

    // 2. Translate
    console.log(JSON.stringify({ level: 'INFO', message: 'Translating', targetLang }));
    const translateCommand = new TranslateDocumentCommand({
      Document: { Content: fileBuffer, ContentType: 'application/pdf' },
      SourceLanguageCode: 'auto',
      TargetLanguageCode: targetLang
    });
    const result = await translateClient.send(translateCommand);
    if (!result.TranslatedDocument?.Content) throw new Error('Translation failed');

    // 3. Save
    const originalName = s3Key.split('/').pop();
    const newKey = `translated/translated-${originalName}`;
    
    console.log(JSON.stringify({ level: 'INFO', message: 'Saving to S3', newKey }));
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: newKey,
      Body: result.TranslatedDocument.Content,
      ContentType: 'application/pdf'
    }));

    // KORREKTUR: Objekt direkt zurückgeben, kein JSON.stringify nötig
    return {
      status: 'DONE',
      downloadPath: newKey,
      fileName: `translated-${originalName}`
    };

  } catch (error: any) {
    console.error(JSON.stringify({ level: 'ERROR', message: error.message }));
    // Auch Fehler als Objekt zurückgeben
    return { status: 'ERROR', error: error.message };
  }
};