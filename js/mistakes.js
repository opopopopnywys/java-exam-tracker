/**
 * mistakes.js
 * 错题本逻辑：增删改查 + 筛选 + 截图管理
 * 支持粘贴(Ctrl+V) / 拖拽 / 点击选择 / 动态替换截图
 * 依赖：StorageDB, ReviewModule
 */

const MistakeModule = (function () {

    // 10天冲刺版错因分类（4 类）
    var REASON_NAMES = {
        'blindspot': '概念盲区',
        'syntax': '语法细节',
        'misread': '审题错误',
        'env': '环境操作',
    };

    // 兼容旧数据的映射（老4类 → 新4类，用于显示旧错题时不至于空白）
    var LEGACY_REASON_MAP = {
        'concept': 'blindspot',         // 概念不清 → 概念盲区
        'memory': 'blindspot',          // 记忆模糊 → 概念盲区
        'careless': 'misread',          // 粗心大意 → 审题错误
        'comprehension': 'syntax',      // 理解错误 → 语法细节
    };
    var LEGACY_REASON_DISPLAY = {
        'concept': '概念不清→盲区',
        'memory': '记忆模糊→盲区',
        'careless': '粗心→审题',
        'comprehension': '理解→语法',
    };

    var STATUS_NAMES = {
        'pending': '未重做',
        'correct': '已重做✓',
        'wrong': '已重做✗',
    };

    var pendingFile = null;
    var replaceInput = null;
    var imageModal = null; // 全屏图片放大模态

    function getReplaceInput() {
        if (!replaceInput) {
            replaceInput = document.createElement('input');
            replaceInput.type = 'file';
            replaceInput.accept = 'image/*';
            replaceInput.style.display = 'none';
            document.body.appendChild(replaceInput);
        }
        return replaceInput;
    }

    // ========== 图片放大模态（点缩略图直接放大） ==========

    function getImageModal() {
        if (imageModal) return imageModal;

        var overlay = document.createElement('div');
        overlay.className = 'image-modal';
        overlay.innerHTML =
            '<button class="image-modal-close" title="关闭 (Esc)">✕</button>' +
            '<div class="image-modal-spinner">加载中...</div>' +
            '<img class="image-modal-img" alt="" style="display:none;">';
        document.body.appendChild(overlay);

        var img = overlay.querySelector('.image-modal-img');
        var spinner = overlay.querySelector('.image-modal-spinner');
        var closeBtn = overlay.querySelector('.image-modal-close');

        img.addEventListener('load', function () {
            spinner.style.display = 'none';
            img.style.display = 'block';
        });
        img.addEventListener('error', function () {
            spinner.textContent = '图片加载失败';
        });

        // 点击背景关闭
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target === closeBtn) {
                closeImageModal();
            }
        });

        closeBtn.addEventListener('click', closeImageModal);

        imageModal = overlay;
        return imageModal;
    }

    function openImageModal(src) {
        if (!src) return;
        var modal = getImageModal();
        var img = modal.querySelector('.image-modal-img');
        var spinner = modal.querySelector('.image-modal-spinner');
        spinner.style.display = 'block';
        spinner.textContent = '加载中...';
        img.style.display = 'none';
        img.src = src;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden'; // 禁止滚动
    }

    function closeImageModal() {
        if (!imageModal) return;
        imageModal.classList.remove('active');
        document.body.style.overflow = '';
        // 延迟清 src，避免关闭瞬间闪一下
        setTimeout(function () {
            if (!imageModal.classList.contains('active')) {
                var img = imageModal.querySelector('.image-modal-img');
                if (img) img.src = '';
            }
        }, 200);
    }

    // ESC 键关闭
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && imageModal && imageModal.classList.contains('active')) {
            closeImageModal();
        }
    });

    // ========== 添加错题（用压缩后的base64存IndexedDB） ==========

    async function addMistake(_a) {
        var chapter = _a.chapter, reason = _a.reason, screenshotFile = _a.screenshotFile, trick = _a.trick, note = _a.note;
        var id = StorageDB.genId();

        if (screenshotFile) {
            try {
                var compressed = await StorageDB.compressImage(screenshotFile, 1000, 0.7);
                await StorageDB.saveScreenshot(id, compressed);
            } catch (e) {
                console.error('截图保存失败', e);
            }
        }

        var record = {
            id: id,
            chapter: chapter,
            chapterName: ReviewModule.CHAPTER_NAMES[chapter] || chapter,
            reason: reason,
            reasonName: REASON_NAMES[reason] || reason,
            trick: trick || '',
            note: note || '',
            status: 'pending',
            createdAt: Date.now(),
            hasScreenshot: !!screenshotFile,
        };

        StorageDB.addMistakeRecord(record);
        return record;
    }

    // ========== 替换已有错题的截图 ==========

    async function replaceScreenshot(id, file) {
        if (!file) return;
        try {
            var compressed = await StorageDB.compressImage(file, 1000, 0.7);
            await StorageDB.saveScreenshot(id, compressed);
            StorageDB.updateMistakeRecord(id, { hasScreenshot: true });
            refresh();
        } catch (e) {
            alert('截图替换失败: ' + e.message);
        }
    }

    // ========== 触发文件选择 → 替换/添加截图 ==========

    function triggerReplaceScreenshot(id) {
        var input = getReplaceInput();
        input.value = '';
        input.onchange = function () {
            if (input.files[0]) {
                replaceScreenshot(id, input.files[0]);
            }
        };
        input.click();
    }

    // ========== 删除已有错题的截图 ==========

    function removeScreenshot(id) {
        if (!confirm('确定删除这条错题的截图?')) return;
        StorageDB.deleteScreenshot(id).then(function () {
            StorageDB.updateMistakeRecord(id, { hasScreenshot: false });
            refresh();
        });
    }

    // ========== 筛选 ==========

    function filterMistakes(_a) {
        var chapter = _a.chapter, reason = _a.reason, status = _a.status;
        var records = StorageDB.getMistakeRecords();

        if (chapter) {
            if (chapter === 'pb') {
                records = records.filter(function (r) { return r.chapter.startsWith('pb'); });
            } else {
                records = records.filter(function (r) { return r.chapter === chapter; });
            }
        }
        if (reason) {
            // 兼容旧数据：筛 blindspot 时也匹配旧的 concept/memory 等
            records = records.filter(function (r) {
                if (r.reason === reason) return true;
                return LEGACY_REASON_MAP[r.reason] === reason;
            });
        }
        if (status) records = records.filter(function (r) { return r.status === status; });

        return records.sort(function (a, b) { return b.createdAt - a.createdAt; });
    }

    // ========== 更新状态 ==========

    function setStatus(id, status) {
        StorageDB.updateMistakeRecord(id, { status: status });
    }

    // ========== 删除 ==========

    function deleteMistake(id) {
        if (confirm('确定删除这条错题?')) {
            StorageDB.deleteMistakeRecord(id);
            return true;
        }
        return false;
    }

    // ========== 统计 ==========

    function getStats() {
        var records = StorageDB.getMistakeRecords();
        return {
            total: records.length,
            pending: records.filter(function (r) { return r.status === 'pending'; }).length,
            correct: records.filter(function (r) { return r.status === 'correct'; }).length,
            wrong: records.filter(function (r) { return r.status === 'wrong'; }).length,
        };
    }

    // ========== 渲染：统计卡片 ==========

    function renderStats() {
        var stats = getStats();
        document.getElementById('stat-total').textContent = stats.total;
        document.getElementById('stat-not-redone').textContent = stats.pending;
        document.getElementById('stat-redone-correct').textContent = stats.correct;
        document.getElementById('stat-redone-wrong').textContent = stats.wrong;
    }

    // ========== 渲染：错题列表（含截图替换/添加按钮） ==========

    async function renderMistakeList(container, filters) {
        var records = filterMistakes(filters || {});

        if (records.length === 0) {
            container.innerHTML = '<div class="empty-state">没有找到错题，去刷题吧</div>';
            return;
        }

        var htmlArray = await Promise.all(records.map(async function (r) {
            var imgHtml = '';
            var imgActions = '';

            // 兼容旧错因：显示时映射到新分类名（仅用于显示，原数据不动）
            var displayReasonKey = LEGACY_REASON_MAP[r.reason] || r.reason;
            var isLegacy = !!LEGACY_REASON_MAP[r.reason];
            var reasonDisplay = isLegacy
                ? LEGACY_REASON_DISPLAY[r.reason]
                : (REASON_NAMES[r.reason] || r.reasonName || r.reason);

            if (r.hasScreenshot) {
                var data = await StorageDB.getScreenshot(r.id);
                if (data) {
                    // 缩略图点击 → 直接放大（不再需要右击打开图片页）
                    imgHtml = '<img class="mistake-img" src="' + data + '" alt="截图" title="点击放大查看" onclick="MistakeModule.openImageModal(this.src)">';
                    imgActions =
                        '<div class="mistake-img-actions">' +
                        '<button class="btn-small btn-replace" onclick="MistakeModule.triggerReplaceScreenshot(\'' + r.id + '\')">替换截图</button>' +
                        '<button class="btn-small" onclick="MistakeModule.removeScreenshot(\'' + r.id + '\')">删除截图</button>' +
                        '</div>';
                }
            } else {
                imgHtml = '<div class="mistake-no-img" onclick="MistakeModule.triggerReplaceScreenshot(\'' + r.id + '\')">点击添加截图</div>';
            }

            return '' +
                '<div class="mistake-card status-' + r.status + '">' +
                    '<div class="mistake-header">' +
                        '<div class="tags">' +
                            '<span class="tag">' + r.chapterName + '</span>' +
                            '<span class="tag reason-' + displayReasonKey + '">' + reasonDisplay + '</span>' +
                            '<span class="tag">' + (STATUS_NAMES[r.status] || r.status) + '</span>' +
                        '</div>' +
                        '<div>' +
                            '<button class="btn-small" onclick="MistakeModule.markCorrect(\'' + r.id + '\')">重做对了</button>' +
                            '<button class="btn-small" onclick="MistakeModule.markWrong(\'' + r.id + '\')">重做错了</button>' +
                            '<button class="btn-small" onclick="MistakeModule.remove(\'' + r.id + '\')">删除</button>' +
                        '</div>' +
                    '</div>' +
                    '<div class="mistake-body">' +
                        '<div class="mistake-img-wrapper">' +
                            imgHtml +
                            imgActions +
                        '</div>' +
                        '<div class="mistake-info">' +
                            (r.trick ? '<div class="trick">' + r.trick + '</div>' : '') +
                            (r.note ? '<div class="note">' + r.note + '</div>' : '') +
                            '<div class="mistake-actions">' +
                                '<span style="font-size:12px;color:#bbb;">添加于 ' + new Date(r.createdAt).toLocaleDateString() + '</span>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</div>';
        }));

        container.innerHTML = htmlArray.join('');
    }

    // ========== 截图区：设置待保存文件 + 显示预览 ==========

    function setPendingFile(file) {
        pendingFile = file;
        var reader = new FileReader();
        reader.onload = function (e) {
            var preview = document.getElementById('screenshot-preview');
            var placeholder = document.getElementById('screenshot-placeholder');
            var clearBtn = document.getElementById('btn-clear-screenshot');
            preview.src = e.target.result;
            preview.style.display = 'block';
            placeholder.style.display = 'none';
            clearBtn.style.display = 'inline-block';
        };
        reader.readAsDataURL(file);
    }

    function clearPendingFile() {
        pendingFile = null;
        var preview = document.getElementById('screenshot-preview');
        var placeholder = document.getElementById('screenshot-placeholder');
        var clearBtn = document.getElementById('btn-clear-screenshot');
        var fileInput = document.getElementById('mistake-screenshot');
        preview.src = '';
        preview.style.display = 'none';
        placeholder.style.display = 'flex';
        clearBtn.style.display = 'none';
        fileInput.value = '';
    }

    // ========== 截图区交互绑定 ==========

    function setupScreenshotZone() {
        var zone = document.getElementById('screenshot-zone');
        var clearBtn = document.getElementById('btn-clear-screenshot');
        var fileInput = document.getElementById('mistake-screenshot');

        if (!zone) return;

        // 点击触发文件选择
        zone.addEventListener('click', function (e) {
            if (e.target === clearBtn) return;
            fileInput.click();
        });

        // 文件选择回调
        fileInput.addEventListener('change', function () {
            if (fileInput.files[0]) {
                setPendingFile(fileInput.files[0]);
            }
        });

        // 拖拽
        zone.addEventListener('dragover', function (e) {
            e.preventDefault();
            zone.classList.add('dragover');
        });
        zone.addEventListener('dragleave', function () {
            zone.classList.remove('dragover');
        });
        zone.addEventListener('drop', function (e) {
            e.preventDefault();
            zone.classList.remove('dragover');
            var file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) {
                setPendingFile(file);
            } else {
                alert('请拖入图片文件');
            }
        });

        // 清除
        clearBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            clearPendingFile();
        });

        // 全局粘贴（只在错题本tab激活时生效）
        document.addEventListener('paste', function (e) {
            var mistakeTab = document.getElementById('tab-mistakes');
            if (!mistakeTab || !mistakeTab.classList.contains('active')) return;

            var items = e.clipboardData.items;
            for (var i = 0; i < items.length; i++) {
                if (items[i].type.startsWith('image/')) {
                    var file = items[i].getAsFile();
                    if (file) {
                        setPendingFile(file);
                        e.preventDefault();
                        break;
                    }
                }
            }
        });
    }

    // ========== 操作快捷方法 ==========

    function markCorrect(id) { setStatus(id, 'correct'); refresh(); }
    function markWrong(id) { setStatus(id, 'wrong'); refresh(); }
    function remove(id) { if (deleteMistake(id)) refresh(); }

    // ========== 刷新 ==========

    function refresh() {
        var filters = {
            chapter: document.getElementById('filter-chapter').value,
            reason: document.getElementById('filter-reason').value,
            status: document.getElementById('filter-status').value,
        };
        renderStats();
        renderMistakeList(document.getElementById('mistake-list'), filters);
        // 同步主页顶部状态条
        if (window.refreshStatusBar) window.refreshStatusBar();
    }

    // ========== 初始化事件绑定 ==========

    function initEvents() {
        // 筛选器变化
        ['filter-chapter', 'filter-reason', 'filter-status'].forEach(function (id) {
            document.getElementById(id).addEventListener('change', refresh);
        });

        // 截图区交互
        setupScreenshotZone();

        // 添加错题按钮
        document.getElementById('btn-add-mistake').addEventListener('click', async function () {
            var chapter = document.getElementById('mistake-chapter').value;
            var reason = document.getElementById('mistake-reason').value;
            var trick = document.getElementById('mistake-trick').value.trim();
            var note = document.getElementById('mistake-note').value.trim();
            var screenshotFile = pendingFile;

            if (!chapter) { alert('请选择章节'); return; }

            await addMistake({ chapter: chapter, reason: reason, screenshotFile: screenshotFile, trick: trick, note: note });

            // 清空表单
            document.getElementById('mistake-chapter').value = '';
            document.getElementById('mistake-reason').value = 'blindspot';
            document.getElementById('mistake-trick').value = '';
            document.getElementById('mistake-note').value = '';
            clearPendingFile();

            refresh();
            alert('已添加到错题本');
        });
    }

    // ========== 对外暴露 ==========

    return {
        REASON_NAMES: REASON_NAMES,
        STATUS_NAMES: STATUS_NAMES,
        addMistake: addMistake,
        filterMistakes: filterMistakes,
        setStatus: setStatus,
        deleteMistake: deleteMistake,
        getStats: getStats,
        renderStats: renderStats,
        renderMistakeList: renderMistakeList,
        refresh: refresh,
        initEvents: initEvents,
        markCorrect: markCorrect,
        markWrong: markWrong,
        remove: remove,
        triggerReplaceScreenshot: triggerReplaceScreenshot,
        removeScreenshot: removeScreenshot,
        replaceScreenshot: replaceScreenshot,
        openImageModal: openImageModal,
        closeImageModal: closeImageModal,
    };
})();
