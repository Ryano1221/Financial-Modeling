"use client";

import type { ClientWorkspaceDocument } from "@/lib/workspace/types";

const DOCUMENT_CACHE_DB_NAME = "thecremodel-workspace";
const DOCUMENT_CACHE_STORE_NAME = "document-caches";
const MAX_LOCALSTORAGE_PREVIEW_CHARS = 250_000;

interface DocumentCacheRecord {
  cacheKey: string;
  documents: ClientWorkspaceDocument[];
  updatedAt: string;
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

function openDocumentCacheDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DOCUMENT_CACHE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DOCUMENT_CACHE_STORE_NAME)) {
        db.createObjectStore(DOCUMENT_CACHE_STORE_NAME, { keyPath: "cacheKey" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open browser document cache."));
  });
}

function withStore<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOCUMENT_CACHE_STORE_NAME, mode);
    const store = transaction.objectStore(DOCUMENT_CACHE_STORE_NAME);
    const request = run(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Browser document cache request failed."));
    transaction.onerror = () => reject(transaction.error || new Error("Browser document cache transaction failed."));
  });
}

function shouldPersistPreviewDataUrl(previewDataUrl: string | undefined): boolean {
  const value = String(previewDataUrl || "").trim();
  if (!value) return false;
  if (!value.startsWith("data:image/")) return false;
  return value.length <= MAX_LOCALSTORAGE_PREVIEW_CHARS;
}

export function buildCompactDocumentCache(documents: ClientWorkspaceDocument[]): ClientWorkspaceDocument[] {
  return documents.map((doc) => ({
    id: doc.id,
    clientId: doc.clientId,
    companyId: doc.companyId,
    dealId: doc.dealId,
    name: doc.name,
    type: doc.type,
    building: doc.building,
    address: doc.address,
    suite: doc.suite,
    parsed: doc.parsed,
    uploadedBy: doc.uploadedBy,
    uploadedAt: doc.uploadedAt,
    sourceModule: doc.sourceModule,
    fileMimeType: doc.fileMimeType,
    ...(shouldPersistPreviewDataUrl(doc.previewDataUrl) ? { previewDataUrl: doc.previewDataUrl } : {}),
  }));
}

export function buildLocalStorageDocumentCache(documents: ClientWorkspaceDocument[]): ClientWorkspaceDocument[] {
  return documents.map((doc) => ({
    id: doc.id,
    clientId: doc.clientId,
    companyId: doc.companyId,
    dealId: doc.dealId,
    name: doc.name,
    type: doc.type,
    building: doc.building,
    address: doc.address,
    suite: doc.suite,
    parsed: doc.parsed,
    uploadedBy: doc.uploadedBy,
    uploadedAt: doc.uploadedAt,
    sourceModule: doc.sourceModule,
    fileMimeType: doc.fileMimeType,
  }));
}

export async function loadDocumentCache(cacheKey: string): Promise<ClientWorkspaceDocument[] | null> {
  const cleanKey = String(cacheKey || "").trim();
  if (!cleanKey) return null;
  const db = await openDocumentCacheDb();
  if (!db) return null;
  try {
    const record = await withStore<DocumentCacheRecord | undefined>(db, "readonly", (store) => store.get(cleanKey));
    return Array.isArray(record?.documents) ? record.documents : [];
  } finally {
    db.close();
  }
}

export async function saveDocumentCache(cacheKey: string, documents: ClientWorkspaceDocument[]): Promise<boolean> {
  const cleanKey = String(cacheKey || "").trim();
  if (!cleanKey) return false;
  const db = await openDocumentCacheDb();
  if (!db) return false;
  try {
    await withStore<IDBValidKey>(db, "readwrite", (store) =>
      store.put({
        cacheKey: cleanKey,
        documents,
        updatedAt: new Date().toISOString(),
      } satisfies DocumentCacheRecord),
    );
    return true;
  } finally {
    db.close();
  }
}

export async function clearDocumentCache(cacheKey: string): Promise<void> {
  const cleanKey = String(cacheKey || "").trim();
  if (!cleanKey) return;
  const db = await openDocumentCacheDb();
  if (!db) return;
  try {
    await withStore<undefined>(db, "readwrite", (store) => store.delete(cleanKey));
  } finally {
    db.close();
  }
}
