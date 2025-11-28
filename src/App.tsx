import React, { useState, useEffect, useRef, ChangeEvent } from 'react';
import { Amplify } from 'aws-amplify';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import outputs from '../amplify_outputs.json';

// I18n & UI
import './i18n';
import { useTranslation } from 'react-i18next';
import { FaCloudUploadAlt, FaDownload, FaSpinner, FaCheckCircle, FaGlobe, FaFilePdf, FaCopy, FaFileWord } from 'react-icons/fa';
import { QRCodeSVG } from 'qrcode.react';
import './App.css';

Amplify.configure(outputs);

const client = generateClient<Schema>();

const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'es', name: 'Español' },
  { code: 'it', name: 'Italiano' },
  { code: 'pt', name: 'Português' },
];

function DownloadView({ fileName }: { fileName: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLink = async () => {
      try {
        // Da fileName jetzt der volle Pfad aus der URL sein kann, prüfen wir das
        const path = fileName.startsWith('translated/') ? fileName : `translated/${fileName}`;
        const link = await getUrl({ path, options: { validateObjectExistence: false, expiresIn: 3600 }});
        setUrl(link.url.toString());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchLink();
  }, [fileName]);

  const isDocx = fileName.toLowerCase().endsWith('.docx');

  return (
    <div className="app-container" style={{ textAlign: 'center', paddingTop: 50 }}>
      <h1>{t('secureDl')}</h1>
      {isDocx ? 
        <FaFileWord size={60} style={{ color: '#2b579a', margin: '20px 0' }} /> :
        <FaFilePdf size={60} style={{ color: 'var(--primary)', margin: '20px 0' }} />
      }
      <p style={{ wordBreak: 'break-all', color: '#fff' }}>{fileName.split('/').pop()}</p>
      {loading ? <FaSpinner className="icon-spin" /> : url ? (
        <a href={url} className="primary-btn" style={{ maxWidth: '200px', margin: '0 auto', textDecoration: 'none' }}>
          <FaDownload /> {t('download')}
        </a>
      ) : <p style={{ color: 'red' }}>File not found.</p>}
      <div style={{ marginTop: 40 }}><a href="/" style={{ color: '#888' }}>{t('back')}</a></div>
    </div>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const params = new URLSearchParams(window.location.search);
  const shareFile = params.get('file');

  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const [status, setStatus] = useState<'IDLE'|'UPLOADING'|'PROCESSING'|'DONE'|'ERROR'>('IDLE');
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const pollRef = useRef<any>(null);

  useEffect(() => {
    fetchAuthSession().catch(e => console.error("Session Init Error:", e));
    return () => clearInterval(pollRef.current);
  }, []);

  if (shareFile) return <DownloadView fileName={shareFile} />;

  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files ? event.target.files[0] : null;
    setFile(null); 
    setStatus('IDLE');
    setErrorMsg(null); 
    setResultUrl(null);
    setShareLink(null);
    setProgress(0);

    if (selectedFile) {
      const name = selectedFile.name.toLowerCase();
      const isPdf = selectedFile.type === 'application/pdf' || name.endsWith('.pdf');
      const isDocx = name.endsWith('.docx') || 
                     selectedFile.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

      if (isPdf || isDocx) {
        setFile(selectedFile);
      } else {
        setErrorMsg('Please select a PDF or DOCX file.');
      }
    }
  };

  const copyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const startTranslation = async () => {
    if (!file) return;
    setStatus('UPLOADING');
    setProgress(0);
    setErrorMsg(null);

    try {
      await fetchAuthSession();

      const cleanName = file.name.replace(/\s+/g, '_');
      const s3Path = `uploads/${Date.now()}/${cleanName}`;
      
      await uploadData({
        path: s3Path, 
        data: file,
        options: {
          onProgress: (p) => p.totalBytes && setProgress(Math.round((p.transferredBytes / p.totalBytes) * 100))
        }
      }).result;
      
      setStatus('PROCESSING');
      
      console.log('Upload complete. Waiting for consistency...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      const { data: startData, errors: startErrors } = await client.queries.translateDocument({
        s3Key: s3Path,
        targetLang,
        action: 'start'
      });

      if (startErrors) throw new Error(startErrors[0].message);
      const startRes = startData ? JSON.parse(startData as string) : {};
      
      if (startRes.status !== 'JOB_STARTED') {
        throw new Error(startRes.error || 'Failed to start job');
      }

      const jobId = startRes.jobId;
      console.log('Job Started:', jobId);

      pollRef.current = setInterval(async () => {
        try {
          const { data: checkData, errors: checkErrors } = await client.queries.translateDocument({
            jobId,
            action: 'check',
            s3Key: s3Path
          });

          if (checkErrors) {
             console.error(checkErrors);
             return; 
          }

          const checkRes = checkData ? JSON.parse(checkData as string) : {};
          console.log('Job Status:', checkRes);

          if (checkRes.status === 'DONE') {
             clearInterval(pollRef.current);
             
             // 1. Hole die signierte URL für den direkten Download Button
             const urlData = await getUrl({ path: checkRes.downloadPath });
             setResultUrl(urlData.url.toString());
             
             // 2. Logik für den Share-Link
             const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
             
             if (isLocalhost) {
                // Wenn lokal: Nutze die direkte S3-URL auch für den Share-Link, 
                // damit man ihn z.B. auf dem Handy öffnen kann (localhost geht dort nicht).
                // Nachteil: Man sieht nicht die schöne DownloadView, sondern direkt die Datei.
                setShareLink(urlData.url.toString());
             } else {
                // Wenn deployt: Nutze den schönen App-Link mit Parameter
                setShareLink(`${window.location.origin}/?file=${encodeURIComponent(checkRes.downloadPath)}`);
             }
             
             setStatus('DONE');
          } else if (checkRes.status === 'ERROR') {
             clearInterval(pollRef.current);
             setStatus('ERROR');
             setErrorMsg(checkRes.error);
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 5000);

    } catch (err: any) {
      console.error(err);
      setStatus('ERROR');
      setErrorMsg(err.message || t('errorGeneric'));
    }
  };

  return (
    <div className="app-container">
      <div className="lang-switch">
        <button className={i18n.language === 'en' ? 'active' : ''} onClick={() => i18n.changeLanguage('en')}>EN</button> | 
        <button className={i18n.language === 'de' ? 'active' : ''} onClick={() => i18n.changeLanguage('de')}>DE</button>
      </div>
      <header className="header">
        <h1><FaGlobe style={{ color: 'var(--primary)' }} /> {t('title')}</h1>
        <p className="subtitle">{t('subtitle')}</p>
      </header>
      <main className="card">
        <div className={`file-input-wrapper ${file ? 'active' : ''}`}>
          <label style={{ width: '100%', display: 'block', cursor: 'pointer' }}>
            <input 
              type="file" 
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" 
              onChange={handleFileSelect} 
              hidden 
              disabled={status === 'UPLOADING' || status === 'PROCESSING'} 
            />
            {file && file.name.endsWith('.docx') ? 
              <FaFileWord size={50} color="#2b579a" /> :
              <FaCloudUploadAlt size={50} color={file ? 'var(--primary)' : '#666'} />
            }
            <p>{file ? file.name : t('selectFile')}</p>
          </label>
        </div>
        {file && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <label style={{ fontSize: '0.9rem', color: '#aaa' }}>{t('translateTo')}</label>
            <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)} disabled={status !== 'IDLE' && status !== 'DONE' && status !== 'ERROR'}>
              {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
            <button className="primary-btn" onClick={startTranslation} disabled={status === 'UPLOADING' || status === 'PROCESSING'}>
              {status === 'UPLOADING' ? t('uploading', { progress }) : 
               status === 'PROCESSING' ? <><FaSpinner className="icon-spin" /> {t('processing')}</> : 
               t('translateBtn')}
            </button>
          </div>
        )}
        {errorMsg && <p style={{ color: '#ff4444', marginTop: 15, textAlign: 'center' }}>{errorMsg}</p>}
        {status === 'DONE' && resultUrl && (
          <div className="result-area">
            <h3><FaCheckCircle /> {t('success')}</h3>
            {/* Direct Download Button */}
            <a href={resultUrl} className="download-link" target="_blank" rel="noreferrer" download>
              <FaDownload /> {t('download')}
            </a>

            {shareLink && (
              <div className="qr-box" style={{ marginTop: 25, background: '#eee', padding: 20, borderRadius: 10, width: '100%' }}>
                <QRCodeSVG value={shareLink} size={140} />
                <div style={{ display: 'flex', marginTop: 15, gap: 5 }}>
                  <input readOnly value={shareLink} style={{ flex: 1 }} />
                  <button onClick={copyLink} style={{ background: 'var(--primary)', border: 'none', cursor: 'pointer' }}>{copied ? <FaCheckCircle /> : <FaCopy />}</button>
                </div>
                <p style={{fontSize: '0.8rem', color: '#666', marginTop: '10px'}}>
                  {window.location.hostname === 'localhost' 
                    ? "Dev-Mode: Direct S3 Link (valid 1h)" 
                    : "Share this secure link"}
                </p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;