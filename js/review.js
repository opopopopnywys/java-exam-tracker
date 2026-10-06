/**
 * review.js
 * 复习日历逻辑：艾宾浩斯曲线 + 掌握度追踪
 * 依赖：StorageDB
 */

const ReviewModule = (function () {

    // 复习间隔（天）—— 10天冲刺压缩版
    // 旧艾宾浩斯 [1,2,4,7,15] 太稀疏（覆盖15天），10天周期不够
    // 新方案：D+2、D+4 两次重做；9/16-17 统一做第三次（即在两套真题前完成第三次重做）
    const REVIEW_INTERVALS = [2, 4];
    const REVIEW_SCHEDULE_NOTE = 'D+2、D+4 + 9/16-17 统一第三遍';

    // 章节中文名映射
    const CHAPTER_NAMES = {
        'ch1': '第1章 基本数据类型',
        'ch2': '第2章 运算符和表达式',
        'ch3': '第3章 流程控制',
        'ch4': '第4章 类与对象',
        'ch5': '第5章 继承与多态',
        'ch6': '第6章 异常处理',
        'ch7': '第7章 线程',
        'ch8': '第8章 GUI界面',
        'ch9': '第9章 Applet',
        'ch10': '第10章 集合与IO',
        'pb1': '公共基础·计算机基础',
        'pb2': '公共基础·数据结构与算法',
        'pb3': '公共基础·程序设计基础',
        'pb4': '公共基础·软件工程基础',
        'pb5': '公共基础·数据库设计基础',
    };

    // 掌握度颜色映射
    const MASTERY_COLORS = {
        'gray': '⚪',
        'blue': '🔵',
        'green': '🟢',
        'yellow': '🟡',
        'red': '🔴',
    };

    // ========== 日期工具 ==========

    function dateStr(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function parseDate(s) {
        if (!s || typeof s !== 'string') return new Date(NaN);
        const parts = s.split('-');
        if (parts.length !== 3) return new Date(NaN);
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }

    function isValidDateStr(s) {
        return typeof s === 'string' && s.match(/^\d{4}-\d{2}-\d{2}$/);
    }

    function dateStrOrFallback(d, fallback) {
        try { return dateStr(d); } catch (e) { return fallback || ''; }
    }

    function addDays(dateString, days) {
        const d = parseDate(dateString);
        d.setDate(d.getDate() + days);
        return dateStr(d); // dateStr 现在指向第 42 行的函数，不再被参数遮蔽
    }

    function daysDiff(dateStr1, dateStr2) {
        const d1 = parseDate(dateStr1);
        const d2 = parseDate(dateStr2);
        return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    // ========== 添加学习记录 ==========

    function addStudyRecord(date, chapter, mastery) {
        const id = StorageDB.genId();
        const record = {
            id,
            date,
            chapter,
            chapterName: CHAPTER_NAMES[chapter] || chapter,
            mastery,
            reviewDates: REVIEW_INTERVALS.map(interval => ({
                date: addDays(date, interval),
                done: false,
            })),
            createdAt: Date.now(),
        };
        StorageDB.addStudyRecord(record);
        return record;
    }

    // ========== 获取今日待复习 ==========

    function getTodayReviews(todayStr) {
        const records = StorageDB.getStudyRecords();
        const today = parseDate(todayStr);
        const result = [];

        records.forEach(record => {
            if (!record || !Array.isArray(record.reviewDates)) return;
            record.reviewDates.forEach(rd => {
                if (!rd || !isValidDateStr(rd.date)) return;
                const rdDate = parseDate(rd.date);
                const diff = daysDiff(todayStr, rd.date);
                if (diff <= 0 && !rd.done) {
                    result.push({
                        recordId: record.id,
                        chapter: record.chapter,
                        chapterName: record.chapterName || CHAPTER_NAMES[record.chapter] || record.chapter,
                        reviewDate: rd.date,
                        diff: diff,
                    });
                }
            });
        });

        // 按过期程度排序：最紧急的排前面
        result.sort((a, b) => a.diff - b.diff);
        return result;
    }

    // ========== 生成未来N天日历 ==========

    function getCalendar(todayStr, daysAhead = 15) {
        const records = StorageDB.getStudyRecords();
        const calendar = [];

        for (let i = 0; i < daysAhead; i++) {
            const d = addDays(todayStr, i);
            const items = [];

            records.forEach(record => {
                if (!record || !Array.isArray(record.reviewDates)) return;
                record.reviewDates.forEach(rd => {
                    if (rd && rd.date === d) {
                        items.push({
                            type: 'review',
                            recordId: record.id,
                            chapterName: record.chapterName || CHAPTER_NAMES[record.chapter] || record.chapter,
                            done: rd.done,
                        });
                    }
                });
            });

            // 学习项（仅今日显示今天学了什么）
            if (d === todayStr) {
                records.forEach(record => {
                    if (record && record.date === d) {
                        items.push({
                            type: 'study',
                            chapterName: record.chapterName || CHAPTER_NAMES[record.chapter] || record.chapter,
                            done: false,
                        });
                    }
                });
            }

            calendar.push({ date: d, items });
        }

        return calendar;
    }

    // ========== 标记复习完成 ==========

    function markReviewDone(recordId, reviewDate) {
        const records = StorageDB.getStudyRecords();
        const record = records.find(r => r.id === recordId);
        if (record) {
            const rd = record.reviewDates.find(r => r.date === reviewDate);
            if (rd) rd.done = true;
            StorageDB.saveStudyRecords(records);
        }
    }

    // ========== 章节掌握度统计 ==========

    function getChapterMastery() {
        const records = StorageDB.getStudyRecords();
        const map = {};

        // 初始化所有章节（即使是灰色占位，让用户看到完整地图）
        Object.keys(CHAPTER_NAMES).forEach(key => {
            map[key] = { id: key, name: CHAPTER_NAMES[key], level: 'gray', count: 0 };
        });

        // 按章节取最新一条记录的掌握度
        const latestByChapter = {};
        records.forEach(r => {
            if (!latestByChapter[r.chapter] || r.createdAt > latestByChapter[r.chapter].createdAt) {
                latestByChapter[r.chapter] = r;
            }
            map[r.chapter].count++;
        });

        Object.keys(latestByChapter).forEach(ch => {
            map[ch].level = latestByChapter[ch].mastery;
        });

        // 返回完整列表（包含 count=0 的灰色占位），让用户看到全章节地图
        return Object.values(map);
    }

    // ========== 更新掌握度 ==========

    function updateMastery(recordId, newMastery) {
        StorageDB.updateStudyRecord(recordId, { mastery: newMastery });
    }

    // ========== 渲染：今日待复习 ==========

    function renderTodayReviews(container, todayStr) {
        const reviews = getTodayReviews(todayStr);
        if (reviews.length === 0) {
            container.innerHTML = '<div class="empty-state">🎉 今天没有待复习内容，可以去刷题了！</div>';
            return;
        }

        container.innerHTML = reviews.map(r => {
            const countdownClass = r.diff === 0 ? 'today' : (r.diff >= -2 ? 'soon' : 'later');
            const countdownText = r.diff === 0 ? '今天复习' : `逾期${Math.abs(r.diff)}天`;
            return `
                <div class="review-item">
                    <div>
                        <span class="chapter-name">${r.chapterName}</span>
                        <span class="due-date">（应在 ${r.reviewDate}）</span>
                    </div>
                    <div>
                        <span class="countdown ${countdownClass}">${countdownText}</span>
                        <button class="btn-small" onclick="ReviewModule.markAndRefresh('${r.recordId}','${r.reviewDate}')">✅ 已复习</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    // ========== 渲染：日历 ==========

    function renderCalendar(container, todayStr) {
        const calendar = getCalendar(todayStr, 15);
        const today = todayStr;

        container.innerHTML = calendar.map(day => {
            const isToday = day.date === today;
            const itemsHtml = day.items.length === 0
                ? '<div style="color:#ccc;font-size:11px;">无</div>'
                : day.items.map(item => {
                    if (item.type === 'study') {
                        return `<div class="cal-item cal-item-study">📖 今学了 ${item.chapterName}</div>`;
                    }
                    return `<div class="cal-item" style="${item.done ? 'opacity:0.4;text-decoration:line-through;' : ''}">🔁 ${item.chapterName}</div>`;
                }).join('');
            return `
                <div class="cal-day ${isToday ? 'today' : ''}">
                    <div class="cal-date">${day.date}${isToday ? ' (今天)' : ''}</div>
                    ${itemsHtml}
                </div>
            `;
        }).join('');
    }

    // ========== 渲染：章节掌握度 ==========

    function renderMastery(container) {
        const chapters = getChapterMastery();
        const hasAnyRecord = chapters.some(ch => ch.count > 0);

        if (!hasAnyRecord) {
            container.innerHTML = `
                <div class="empty-state" style="grid-column:1/-1;">
                    📊 还没有学习记录——但下面这14个章节地图已就位，先选一章开始吧 ↓
                </div>
            `;
            // 仍然渲染地图（让用户看到完整结构）
            container.innerHTML += chapters.map(ch => `
                <div class="mastery-item ${ch.count === 0 ? 'empty' : ''}">
                    <span>${ch.name}</span>
                    <span class="mastery-dot ${ch.level}"></span>
                </div>
            `).join('');
            return;
        }

        container.innerHTML = chapters.map(ch => `
            <div class="mastery-item ${ch.count === 0 ? 'empty' : ''}">
                <span>${ch.name}</span>
                <span class="mastery-dot ${ch.level}"></span>
            </div>
        `).join('');
    }

    // ========== 对外暴露 ==========

    return {
        CHAPTER_NAMES,
        MASTERY_COLORS,
        addStudyRecord,
        getTodayReviews,
        getCalendar,
        markReviewDone,
        getChapterMastery,
        updateMastery,
        renderTodayReviews,
        renderCalendar,
        renderMastery,
        dateStr,
        parseDate,
        addDays,
        // 供onclick调用
        markAndRefresh(recordId, reviewDate) {
            try {
                markReviewDone(recordId, reviewDate);
                const today = new Date().toISOString().slice(0, 10); // 不依赖外部 dateStr，防缓存旧版
                const todayEl = document.getElementById('today-date');
                if (todayEl) todayEl.textContent = today;
                renderTodayReviews(document.getElementById('today-review-list'), today);
                renderCalendar(document.getElementById('review-calendar'), today);
                if (window.refreshStatusBar) window.refreshStatusBar();
            } catch (err) {
                console.error('[markAndRefresh]', err);
                alert('标记复习时出错：' + err.message);
            }
        },
        refreshAll() {
            try {
                const today = new Date().toISOString().slice(0, 10); // 不依赖外部 dateStr，防缓存旧版
                const todayEl = document.getElementById('today-date');
                if (todayEl) todayEl.textContent = today;
                renderTodayReviews(document.getElementById('today-review-list'), today);
                renderCalendar(document.getElementById('review-calendar'), today);
                renderMastery(document.getElementById('chapter-mastery'));
                if (window.refreshStatusBar) window.refreshStatusBar();
            } catch (err) {
                console.error('[refreshAll]', err);
                const el = document.getElementById('today-review-list');
                if (el) el.innerHTML = '<div class="empty-state" style="color:#e74c3c;">⚠️ 渲染出错：' + err.message + '<br><small>按 F12 → Console 可以看到详细错误</small></div>';
            }
        }
    };
})();
