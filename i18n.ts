// src/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      appTitle: "Document Translator",
      subtitle: "(v 1.0.1 - Amazon Translate & Share)",
      dropzone: "Select PDF file...",
      translateBtn: "Translate Document",
      processing: "Translating...",
      uploading: "Uploading: {{progress}}%",
      success: "Translation Complete!",
      download: "Download PDF",
      share: "Share Result",
      scanQr: "Scan QR code for mobile download",
      errorFile: "Please select a valid PDF file.",
      errorGeneric: "An error occurred.",
      secureDl: "Secure Download",
      back: "Back to Translator"
    }
  },
  de: {
    translation: {
      appTitle: "Dokumenten Übersetzer",
      subtitle: "(v 1.0.1 - Amazon Translate & Share)",
      dropzone: "PDF Datei auswählen...",
      translateBtn: "Dokument übersetzen",
      processing: "Übersetze...",
      uploading: "Lade hoch: {{progress}}%",
      success: "Übersetzung abgeschlossen!",
      download: "PDF Herunterladen",
      share: "Ergebnis teilen",
      scanQr: "QR-Code scannen für Download",
      errorFile: "Bitte wählen Sie eine gültige PDF-Datei.",
      errorGeneric: "Ein Fehler ist aufgetreten.",
      secureDl: "Sicherer Download",
      back: "Zurück zum Übersetzer"
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: { escapeValue: false }
  });

export default i18n;