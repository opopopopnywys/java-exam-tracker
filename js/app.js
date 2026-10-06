/**
 * app.js
 * 入口文件：Tab切换 + 初始化事件 + 渲染调度
 * 依赖：StorageDB, ReviewModule, MistakeModule
 */

(function () {

    // ========== Tab 切换 ==========

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-tab');

            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById('tab-' + target).classList.add('active');

            // 切换到对应tab时刷新数据
            if (target === 'review') {
                ReviewModule.refreshAll();
            } else if (target === 'mistakes') {
                MistakeModule.refresh();
            }
        });
    });

    // ========== 复习日历：添加学习记录 ==========

    document.getElementById('btn-add-study').addEventListener('click', () => {
        const dateInput = document.getElementById('study-date');
        const chapter = document.getElementById('study-chapter').value;
        const mastery = document.getElementById('study-mastery').value;

        const date = dateInput.value || new Date().toISOString().slice(0, 10);

        if (!chapter) {
            showStudyFeedback('请先选择章节！', 'error');
            return;
        }

        const chapterName = ReviewModule.CHAPTER_NAMES[chapter] || chapter;
        const record = ReviewModule.addStudyRecord(date, chapter, mastery);

        // 重置表单（保留日期，方便连续添加同一日期的多章）
        dateInput.value = date;
        document.getElementById('study-chapter').value = '';
        document.getElementById('study-mastery').value = 'gray';

        ReviewModule.refreshAll();

        // 显示内嵌反馈（看得到+告诉用户复习计划）
        const firstReview = record.reviewDates[0].date; // D+2 的日期
        const secondReview = record.reviewDates[1] ? record.reviewDates[1].date : null;
        const today = new Date().toISOString().slice(0, 10);
        const reviewHint = firstReview > today
            ? `首次重做 <b>${firstReview}</b>，第二次 <b>${secondReview}</b>`
            : `今日首次重做 <b>${firstReview}</b>`;
        showStudyFeedback(
            `✅ 已记录 <b>${chapterName}</b>（${date}）· ${reviewHint} · 9/16-17 统一第三遍`,
            'success'
        );

        // 同步状态条
        if (window.refreshStatusBar) window.refreshStatusBar();
    });

    // ========== 复习日历：添加记录的即时反馈 ==========

    function showStudyFeedback(msg, type) {
        const el = document.getElementById('study-feedback');
        if (!el) { alert(msg); return; } // 兜底
        el.innerHTML = msg;
        el.className = 'study-feedback ' + type;
        el.style.display = 'block';
        // 错误提示5秒后消失，成功提示10秒
        const ttl = type === 'error' ? 5000 : 10000;
        setTimeout(() => { el.style.display = 'none'; }, ttl);
    }

    // ========== 初始化 ==========

    function init() {
        // 设置日期默认值为今天
        const today = new Date().toISOString().slice(0, 10);
        document.getElementById('study-date').value = today;

        // 渲染今日日期
        document.getElementById('today-date').textContent = today;

        // 初始化错题本事件
        MistakeModule.initEvents();

        // 首次渲染
        ReviewModule.refreshAll();
        MistakeModule.refresh();

        // 状态条刷新
        refreshStatusBar();
    }

    // ========== 实时状态条 ==========

    function refreshStatusBar() {
        const recordsEl = document.getElementById('status-records');
        const reviewsEl = document.getElementById('status-reviews');
        const mistakesEl = document.getElementById('status-mistakes');

        try {
            const records = StorageDB.getStudyRecords();
            const today = new Date().toISOString().slice(0, 10);
            const todayReviews = ReviewModule.getTodayReviews(today);
            const mistakes = MistakeModule.filterMistakes ? MistakeModule.filterMistakes({}) : [];

            recordsEl.innerHTML = `学习记录：<b>${records.length}</b> 条`;
            reviewsEl.innerHTML = `今日待复习：<b>${todayReviews.length}</b> 项`;
            mistakesEl.innerHTML = `错题：<b>${mistakes.length}</b> 题`;
        } catch (err) {
            recordsEl.innerHTML = '读取失败';
            reviewsEl.innerHTML = `<span style="color:#ff6b6b">${err.message}</span>`;
            mistakesEl.innerHTML = '请检查 localStorage 是否被禁用';
            // 安全降级：让页面其余部分继续渲染
            console.error('[refreshStatusBar]', err);
        }
    }

    // 全局暴露给其他模块调用
    window.refreshStatusBar = refreshStatusBar;

    // ========== 清空所有数据（调试用） ==========

    document.getElementById('btn-clear-all').addEventListener('click', async () => {
        const ok = confirm('⚠️ 真的要清空所有学习记录和错题吗？\n（清空后你需要重新添加，但能验证数据能否正常写入）');
        if (!ok) return;

        // 文字数据：走 StorageDB 统一出口（键名由 storage.js 管理，避免再出现键名对不上的 bug）
        StorageDB.clearAllData();
        // 截图：清空 IndexedDB 里的 store（不用 deleteDatabase，避免被未关闭的连接阻塞）
        await StorageDB.clearScreenshots();

        alert('✅ 数据已清空。\n\n现在试试点「添加记录」——\n1. 状态条数字应该 +1\n2. 「今天该复习什么」会出现「第N章」\n3. 「未来15天」会显示「📖 今学了第N章」（黄底）\n4. 「章节掌握度」那章的圆点会从灰变亮');
        if (window.refreshStatusBar) window.refreshStatusBar();
        ReviewModule.refreshAll();
        MistakeModule.refresh();
    });

    // DOM加载完成后启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
