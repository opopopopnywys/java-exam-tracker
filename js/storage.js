/**
 * storage.js
 * 封装 localStorage（文字数据） + IndexedDB（截图文件）
 * 对外暴露全局对象 StorageDB
 */

const StorageDB = (function () {

    // ========== localStorage 部分 ==========

    const STUDY_KEY = 'java_review_study_records';   // 学习记录
    const MISTAKE_KEY = 'java_review_mistake_records'; // 错题记录（不含截图）
    const SETTINGS_KEY = 'java_review_settings';

    function getStudyRecords() {
        return JSON.parse(localStorage.getItem(STUDY_KEY) || '[]');
    }

    function saveStudyRecords(records) {
        localStorage.setItem(STUDY_KEY, JSON.stringify(records));
    }

    function getMistakeRecords() {
        return JSON.parse(localStorage.getItem(MISTAKE_KEY) || '[]');
    }

    function saveMistakeRecords(records) {
        localStorage.setItem(MISTAKE_KEY, JSON.stringify(records));
    }

    // ========== IndexedDB 部分（存截图） ==========

    const DB_NAME = 'JavaExamDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'screenshots';

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = function (e) {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = function (e) { resolve(e.target.result); };
            request.onerror = function (e) { reject(e.target.error); };
        });
    }

    async function saveScreenshot(id, base64Data) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ id: id, data: base64Data });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async function getScreenshot(id) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const request = tx.objectStore(STORE_NAME).get(id);
            request.onsuccess = () => resolve(request.result ? request.result.data : null);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function deleteScreenshot(id) {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
        });
    }

    async function clearScreenshots() {
        const db = await openDB();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }

    // ========== 文件转base64 ==========

    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    // ========== 图片压缩（canvas缩放 + JPEG质量压缩） ==========

    function compressImage(file, maxWidth, quality) {
        maxWidth = maxWidth || 1000;
        quality = quality || 0.7;
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = function (e) {
                const img = new Image();
                img.onload = function () {
                    var w = img.width, h = img.height;
                    if (w > maxWidth) {
                        h = Math.round(h * (maxWidth / w));
                        w = maxWidth;
                    }
                    var canvas = document.createElement('canvas');
                    canvas.width = w;
                    canvas.height = h;
                    var ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, w, h);
                    var isPng = file.type === 'image/png';
                    var mime = isPng ? 'image/png' : 'image/jpeg';
                    try {
                        var dataUrl = canvas.toDataURL(mime, quality);
                        resolve(dataUrl);
                    } catch (err) {
                        // 某些浏览器安全限制下canvas会抛异常，退回原始base64
                        resolve(e.target.result);
                    }
                };
                img.onerror = function () { reject(new Error('图片加载失败')); };
                img.src = e.target.result;
            };
            reader.onerror = function () { reject(reader.error); };
            reader.readAsDataURL(file);
        });
    }

    // ========== 对外暴露 ==========

    return {
        // 学习记录
        getStudyRecords,
        saveStudyRecords,
        addStudyRecord(record) {
            const records = getStudyRecords();
            records.push(record);
            saveStudyRecords(records);
        },
        updateStudyRecord(id, updates) {
            const records = getStudyRecords();
            const idx = records.findIndex(r => r.id === id);
            if (idx >= 0) { records[idx] = { ...records[idx], ...updates }; saveStudyRecords(records); }
        },
        deleteStudyRecord(id) {
            const records = getStudyRecords().filter(r => r.id !== id);
            saveStudyRecords(records);
        },

        // 错题记录
        getMistakeRecords,
        saveMistakeRecords,
        addMistakeRecord(record) {
            const records = getMistakeRecords();
            records.push(record);
            saveMistakeRecords(records);
        },
        updateMistakeRecord(id, updates) {
            const records = getMistakeRecords();
            const idx = records.findIndex(r => r.id === id);
            if (idx >= 0) { records[idx] = { ...records[idx], ...updates }; saveMistakeRecords(records); }
        },
        deleteMistakeRecord(id) {
            const records = getMistakeRecords().filter(r => r.id !== id);
            saveMistakeRecords(records);
            // 同时删截图
            deleteScreenshot(id).catch(() => {});
        },

        // 截图
        saveScreenshot,
        getScreenshot,
        deleteScreenshot,
        clearScreenshots,

        // 清空全部数据（键名只在 storage.js 内部管理，外部不许再猜键名）
        clearAllData() {
            localStorage.removeItem(STUDY_KEY);
            localStorage.removeItem(MISTAKE_KEY);
            localStorage.removeItem(SETTINGS_KEY);
        },

        // 工具
        fileToBase64,
        compressImage,

        // 生成唯一ID
        genId() {
            return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
        }
    };
})();
