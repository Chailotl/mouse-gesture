// 禁用所有控制台日志
console.log = function () { };
console.error = function () { };
console.warn = function () { };
console.info = function () { };
console.debug = function () { };

// 在页面加载之前立即读取并应用主题设置
(function () {
	try {
		// 尝试从存储中获取主题设置
		chrome.storage.sync.get({ theme: 'light' }, function (items) {
			// 应用存储的主题
			const theme = items.theme || 'light';
			document.documentElement.setAttribute('data-theme', theme);
			console.log('预加载主题:', theme);

			// 等待DOM完全加载后更新主题切换按钮
			document.addEventListener('DOMContentLoaded', function () {
				const themeToggle = document.getElementById('theme-toggle');
				if (themeToggle) {
					// 深色模式显示太阳☀️，浅色模式显示月亮🌙
					themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
				}
			});
		});
	} catch (e) {
		console.error('预加载主题时出错:', e.message);
		// 出错时应用默认主题
		document.documentElement.setAttribute('data-theme', 'light');
	}
})();