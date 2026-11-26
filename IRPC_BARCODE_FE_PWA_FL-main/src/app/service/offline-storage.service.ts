import { Injectable, inject } from '@angular/core';
import { NetworkService } from './network.service';

@Injectable({
  providedIn: 'root'
})
export class OfflineStorageService {

  private readonly DB_NAME = 'wms_offline_db';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'offline_cache';

  private dbPromise: Promise<IDBDatabase> | null = null;

  private network = inject(NetworkService);

  //  Open (or Create) IndexedDB Database — Singleton Connection
  private openDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }

    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        resolve((event.target as IDBOpenDBRequest).result);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.dbPromise;
  }

  //  Save Any Data Under A Given Key
  async save(key: string, data: any): Promise<void> {
    try {
      const db = await this.openDb();
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      store.put({
        key: key,
        data: data,
        savedAt: new Date().toISOString(),
      });

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

    } catch (error) {
      console.log('OfflineStorageService Save Error :', error);
    }
  }

  //  Load Data By Key
  async load<T = any>(key: string): Promise<T | null> {
    try {
      const db = await this.openDb();
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      const result = await new Promise<any>((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      return result ? (result.data as T) : null;

    } catch (error) {
      console.log('OfflineStorageService Load Error :', error);
      return null;
    }
  }

  //  Get Last Saved Timestamp For A Key (Optional, Useful For "Last Updated" UI)
  async getSavedAt(key: string): Promise<string | null> {
    try {
      const db = await this.openDb();
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      const result = await new Promise<any>((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      return result ? result.savedAt : null;

    } catch (error) {
      console.log('OfflineStorageService GetSavedAt Error :', error);
      return null;
    }
  }

  //  Remove Data By Key
  async remove(key: string): Promise<void> {
    try {
      const db = await this.openDb();
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      store.delete(key);

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

    } catch (error) {
      console.log('OfflineStorageService Remove Error :', error);
    }
  }

  //  Check Current Network Status (จาก health check api/v1/health ผ่าน NetworkService)
  isOnline(): boolean {
    return this.network.isOnline;
  }
}