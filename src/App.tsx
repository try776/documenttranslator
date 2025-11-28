import { useState, useEffect, useRef, ChangeEvent } from 'react';
import { Amplify } from 'aws-amplify';
import { uploadData, getUrl } from 'aws-amplify/storage';
import { generateClient } from 'aws-amplify/data';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Schema } from '../amplify/data/resource';
import outputs from '../amplify_outputs.json';

// I18n & UI
import './i18n';
import { useTranslation } from 'react-i18next';
import { FaCloudUploadAlt, FaSpinner, FaCheckCircle, FaGlobe, FaFilePdf, FaCopy, FaFileWord, FaShareAlt, FaDownload } from 'react-icons/fa';
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

// --- Download Screen Component ---
function DownloadView({ fileName }: { fileName: string }) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchLink = async () => {
      try {
        const path = fileName.startsWith('translated/') ? fileName : `translated/${fileName}`;
        const link = await getUrl({ 
          path, 
          options: { validateObjectExistence: false, expiresIn: 3600 }
        });
        setUrl(link.url.toString());
      } catch (e) {
        console.error("Download Error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchLink();
  }, [fileName]);

  const isDocx = fileName.toLowerCase().endsWith('.docx');
  const displayFileName = fileName.split('/').pop();

  return (
    <div className="app-container download-view">
      <h1>{t('secureDl')}</h1>
      
      <div className="file-preview">
        {isDocx ? 
          <FaFileWord size={80} color="#2b579a" /> :
          <FaFilePdf size={80} color="#ff9900" />
        }
      </div>
      
      <p style={{ wordBreak: 'break-all', marginBottom: 30, color: '#fff' }}>
        {displayFileName}
      </p>
      
      {loading ? (
        <FaSpinner className="icon-spin" size={24} /> 
      ) : url ? (
        <a href={url} className="primary-btn" style={{ maxWidth: '250px', margin: '0 auto' }}>
          <FaDownload /> {t('download')}
        </a>
      ) : (
        <p style={{ color: '#ff4444' }}>File not found or link expired.</p>
      )}
      
      <div style={{ marginTop: 20 }}>
        <a href="/" className="back-link">← {t('back')}</a>
      </div>
    </div>
  );
}

// --- Main App Component ---
function App() {
  const { t, i18n } = useTranslation();
  const params = new URLSearchParams(window.location.search);
  const shareFile = params.get('file');

  const [file, setFile] = useState<File | null>(null);
  const [targetLang, setTargetLang] = useState('en');
  const [status, setStatus] = useState<'IDLE'|'UPLOADING'|'PROCESSING'|'DONE'|'ERROR'>('IDLE');
  const [progress, setProgress] = useState(0);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [directDownloadUrl, setDirectDownloadUrl] = useState<string | null>(null);
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
    setShareLink(null);
    setDirectDownloadUrl(null);
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

      pollRef.current = setInterval(async () => {
        try {
          const { data: checkData, errors: checkErrors } = await client.queries.translateDocument({
            jobId,
            action: 'check',
            s3Key: s3Path
          });

          if (checkErrors) { console.error(checkErrors); return; }

          const checkRes = checkData ? JSON.parse(checkData as string) : {};
          console.log('Job Status:', checkRes);

          if (checkRes.status === 'DONE') {
              clearInterval(pollRef.current);
              
              const finalPath = checkRes.downloadPath;
              
              const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
              if (isLocalhost) {
                const urlData = await getUrl({ path: finalPath });
                setShareLink(urlData.url.toString());
                setDirectDownloadUrl(urlData.url.toString());
              } else {
                setShareLink(`${window.location.origin}/?file=${encodeURIComponent(finalPath)}`);
                const downloadUrlData = await getUrl({ path: finalPath });
                setDirectDownloadUrl(downloadUrlData.url.toString());
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
        <button className={i18n.language === 'en' ? 'active' : ''} onClick={() => i18n.changeLanguage('en')}>EN</button> 
        <span style={{color:'#555'}}>|</span>
        <button className={i18n.language === 'de' ? 'active' : ''} onClick={() => i18n.changeLanguage('de')}>DE</button>
      </div>

      <header className="header">
        <h1><FaGlobe style={{ color: 'var(--primary)' }} /> {t('title')}</h1>
        <p className="subtitle">{t('subtitle')}</p>
      </header>

      <main className="card">
        {/* File Selection */}
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
              <FaFileWord size={48} color="#2b579a" /> :
              <FaCloudUploadAlt size={48} color={file ? 'var(--primary)' : 'var(--text-secondary)'} />
            }
            <p>{file ? file.name : t('selectFile')}</p>
          </label>
        </div>

        {/* Translation Options */}
        {file && (
          <div style={{ animation: 'fadeIn 0.3s ease' }}>
            <div className="form-group">
              <label>{t('translateTo')}</label>
              <select 
                value={targetLang} 
                onChange={(e) => setTargetLang(e.target.value)} 
                disabled={status !== 'IDLE' && status !== 'DONE' && status !== 'ERROR'}
              >
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            </div>

            <button className="primary-btn" onClick={startTranslation} disabled={status === 'UPLOADING' || status === 'PROCESSING'}>
              {status === 'UPLOADING' ? `${t('uploading')} ${progress}%` : 
               status === 'PROCESSING' ? <><FaSpinner className="icon-spin" /> {t('processing')}</> : 
               t('translateBtn')}
            </button>
          </div>
        )}

        {errorMsg && <p style={{ color: '#ff4444', marginTop: 15, textAlign: 'center' }}>{errorMsg}</p>}

        {/* Success / Result Area */}
        {status === 'DONE' && shareLink && (
          <div className="result-area">
            <div className="result-header">
              <FaCheckCircle /> {t('success')}
            </div>
            
            <div className="share-container">
              <h4 style={{ margin: '0 0 15px 0', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <FaShareAlt /> {t('share')}
              </h4>
              
              <div className="qr-wrapper">
                <QRCodeSVG value={shareLink} size={140} level={"L"} includeMargin={false} />
              </div>
              
              <div className="copy-row">
                <input className="share-input" readOnly value={shareLink} onClick={(e) => e.currentTarget.select()} />
                <button className="icon-btn" onClick={copyLink} title="Copy Link">
                  {copied ? <FaCheckCircle color="var(--success)" /> : <FaCopy />}
                </button>
              </div>

              {directDownloadUrl && (
                  <a href={directDownloadUrl} target="_blank" rel="noopener noreferrer" className="primary-btn secondary-btn">
                    <FaDownload /> {t('download')}
                  </a>
              )}

              <p style={{ fontSize: '0.75rem', color: '#666', marginTop: '15px' }}>
                {window.location.hostname === 'localhost' ? "Dev: Direct S3 Link" : "Secure shareable link"}
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;