// src/App.tsx
import React, { useState, useEffect } from 'react';
import { Amplify } from 'aws-amplify';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data'; // NEU
import type { Schema } from '../amplify/data/resource'; // Typen Import
import outputs from '../amplify_outputs.json';

// I18n & UI
import './i18n';
import { useTranslation } from 'react-i18next';
import { FaCloudUploadAlt, FaDownload, FaSpinner, FaCheckCircle, FaGlobe, FaShareAlt, FaFilePdf, FaCopy } from 'react-icons/fa';
import { QRCodeSVG } from 'qrcode.react';
import './App.css';

Amplify.configure(outputs);

const client = generateClient<Schema>(); // Typisierter Client

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

  return (
    <div className="app-container" style={{ textAlign: 'center', paddingTop: 50 }}>
      <h1>{t('secureDl')}</h1>
      <FaFilePdf size={60} style={{ color: 'var(--primary)', margin: '20px 0' }} />
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

  if (shareFile) return <DownloadView fileName={shareFile} />;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0]);
      setStatus('IDLE');
      setErrorMsg(null);
      setResultUrl(null);
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

    try {
      const s3Key = `uploads/${Date.now()}-${file.name}`;
      await uploadData({
        key: s3Key,
        data: file,
        options: {
          onProgress: (p) => p.totalBytes && setProgress(Math.round((p.transferredBytes / p.totalBytes) * 100))
        }
      }).result;
      
      setStatus('PROCESSING');
      
      // NEU: Aufruf via Data Client statt API.post
      const { data: responseString, errors } = await client.models.translateDocument({
        s3Key,
        targetLang
      });

      if (errors) throw new Error(errors[0].message);
      
      // Lambda gibt JSON-String zurück, den wir parsen müssen
      const data = responseString ? JSON.parse(responseString) : {};

      if (data.status === 'DONE' && data.downloadPath) {
        const urlData = await getUrl({ path: data.downloadPath });
        setResultUrl(urlData.url.toString());
        const cleanName = data.fileName || data.downloadPath.split('/').pop();
        setShareLink(`${window.location.origin}/?file=${encodeURIComponent(cleanName)}`);
        setStatus('DONE');
      } else {
        throw new Error(data.error || 'Translation failed');
      }
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
            <input type="file" accept=".pdf" onChange={handleFileSelect} hidden disabled={status === 'UPLOADING' || status === 'PROCESSING'} />
            <FaCloudUploadAlt size={50} color={file ? 'var(--primary)' : '#666'} />
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
            <a href={resultUrl} className="download-link" target="_blank" rel="noreferrer"><FaDownload /> {t('download')}</a>
            {shareLink && (
              <div className="qr-box" style={{ marginTop: 25, background: '#eee', padding: 20, borderRadius: 10, width: '100%' }}>
                <QRCodeSVG value={shareLink} size={140} />
                <div style={{ display: 'flex', marginTop: 15, gap: 5 }}>
                  <input readOnly value={shareLink} style={{ flex: 1 }} />
                  <button onClick={copyLink} style={{ background: 'var(--primary)', border: 'none', cursor: 'pointer' }}>{copied ? <FaCheckCircle /> : <FaCopy />}</button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;