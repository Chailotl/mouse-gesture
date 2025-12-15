// 禁用所有控制台日志
console.log = function () { };
console.error = function () { };
console.warn = function () { };
console.info = function () { };
console.debug = function () { };

// 常量定义
const SPECIAL_PROTOCOLS = [
	'chrome-extension://',
	'chrome://',
	'edge://',
	'about:',
	'data:',
	'file://',
	'view-source:',
	'javascript:',
	'ftp://',
	'ws://',
	'wss://',
	'http://',
	'https://'
];

const NEW_TAB_URLS = [
	'chrome://newtab/',
	'edge://newtab/',
	'about:newtab',
	'chrome://new-tab-page/',
	'about:blank'
];

const IGNORED_PROTOCOLS = [
	'chrome://',
	'edge://',
	'about:',
	'chrome-extension://'
];

// 全局变量定义
let lastCheckedTab = {
	id: null,
	url: null,
	time: 0,
	cooldown: 5000,
	processedUrls: new Map()
};

// URL标准化缓存
const urlNormalizeCache = new Map();
const MAX_CACHE_SIZE = 2000; // 增加到2000条
const CACHE_CLEANUP_THRESHOLD = 0.9; // 缓存使用率达到90%时清理

// 全局URL标准化函数（带缓存）
function normalizeUrl(inputUrl) {
	if (!inputUrl) return '';

	// 检查缓存
	if (urlNormalizeCache.has(inputUrl)) {
		const cacheEntry = urlNormalizeCache.get(inputUrl);
		cacheEntry.accessCount++; // 增加访问计数
		return cacheEntry.result;
	}

	let result;
	try {
		let urlObj;
		try {
			urlObj = new URL(inputUrl);
		} catch (e) {
			try {
				urlObj = new URL('https://' + inputUrl);
			} catch (e2) {
				result = inputUrl.toLowerCase();
				// 缓存结果
				if (urlNormalizeCache.size < MAX_CACHE_SIZE) {
					urlNormalizeCache.set(inputUrl, result);
				}
				return result;
			}
		}

		let hostname = urlObj.hostname.toLowerCase();
		if (hostname.startsWith('www.')) {
			hostname = hostname.substring(4);
		}

		let pathname = urlObj.pathname;
		if (pathname.length > 1 && pathname.endsWith('/')) {
			pathname = pathname.slice(0, -1);
		}

		// 忽略常见追踪参数
		const ignoredParams = new Set([
			'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
			'fbclid', 'gclid', 'msclkid', 'ref', 'source', 'ref_src', '_ga'
		]);

		let cleanParams = new URLSearchParams();
		for (let [key, value] of urlObj.searchParams.entries()) {
			if (!ignoredParams.has(key.toLowerCase())) {
				cleanParams.append(key.toLowerCase(), value);
			}
		}

		const sortedParams = Array.from(cleanParams.entries())
			.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

		const cleanQuery = sortedParams.length > 0
			? '?' + sortedParams.map(([k, v]) => `${k}=${v}`).join('&')
			: '';

		// 处理锚点(#)，只有当它是URL的末尾且没有实际内容时才忽略
		let hash = '';
		if (urlObj.hash && urlObj.hash !== '#') {
			hash = urlObj.hash;
		}

		result = `${urlObj.protocol}//${hostname}${pathname}${cleanQuery}${hash}`;
	} catch (e) {
		console.warn('URL标准化失败:', e.message);
		result = inputUrl.toLowerCase();
	}

	// 智能缓存管理
	if (urlNormalizeCache.size >= MAX_CACHE_SIZE) {
		// 缓存已满，清理最旧的条目
		clearOldestCacheEntries();
	}

	// 缓存结果
	urlNormalizeCache.set(inputUrl, {
		result: result,
		timestamp: Date.now(),
		accessCount: 1
	});

	return result;
}

// 清理URL标准化缓存
function clearUrlNormalizeCache() {
	urlNormalizeCache.clear();
}

// 智能清理最旧的缓存条目
function clearOldestCacheEntries() {
	const entries = Array.from(urlNormalizeCache.entries());

	// 按访问频率和时间排序，优先保留高频访问的条目
	entries.sort((a, b) => {
		const [urlA, entryA] = a;
		const [urlB, entryB] = b;

		// 计算访问频率分数（访问次数 / 时间差）
		const timeA = Date.now() - entryA.timestamp;
		const timeB = Date.now() - entryB.timestamp;
		const scoreA = entryA.accessCount / Math.max(timeA, 1);
		const scoreB = entryB.accessCount / Math.max(timeB, 1);

		return scoreA - scoreB; // 分数低的先删除
	});

	// 删除最旧的25%条目
	const deleteCount = Math.floor(entries.length * 0.25);
	for (let i = 0; i < deleteCount; i++) {
		urlNormalizeCache.delete(entries[i][0]);
	}

	console.log(`清理了 ${deleteCount} 个最旧的缓存条目`);
}

// 检查缓存使用率并智能清理
function checkAndCleanCache() {
	const usageRatio = urlNormalizeCache.size / MAX_CACHE_SIZE;

	if (usageRatio >= CACHE_CLEANUP_THRESHOLD) {
		console.log(`缓存使用率 ${(usageRatio * 100).toFixed(1)}% 超过阈值，开始清理`);
		clearOldestCacheEntries();
	}
}

// 获取缓存统计信息
function getCacheStats() {
	const entries = Array.from(urlNormalizeCache.values());
	const totalAccessCount = entries.reduce((sum, entry) => sum + entry.accessCount, 0);
	const avgAccessCount = entries.length > 0 ? totalAccessCount / entries.length : 0;

	return {
		size: urlNormalizeCache.size,
		maxSize: MAX_CACHE_SIZE,
		usageRatio: urlNormalizeCache.size / MAX_CACHE_SIZE,
		totalAccessCount: totalAccessCount,
		avgAccessCount: avgAccessCount,
		lastCleanupTime: lastCleanupTime
	};
}

// 定期输出缓存统计（仅在开发模式下）
function logCacheStats() {
	const stats = getCacheStats();
	console.log('缓存统计:', {
		使用率: `${(stats.usageRatio * 100).toFixed(1)}%`,
		条目数: `${stats.size}/${stats.maxSize}`,
		总访问次数: stats.totalAccessCount,
		平均访问次数: stats.avgAccessCount.toFixed(2)
	});
}

// 检查标签页是否为有效标签页（非特殊页面）
function isValidTab(tab) {
	if (!tab || !tab.url) return false;

	// 跳过空白标签页和特殊页面
	if (tab.url.startsWith('chrome://') ||
		tab.url.startsWith('edge://') ||
		tab.url.startsWith('about:') ||
		NEW_TAB_URLS.includes(tab.url)) {
		return false;
	}

	return true;
}

// 批量标准化URL列表
function batchNormalizeUrls(tabs) {
	const normalizedUrls = new Map();

	for (const tab of tabs) {
		if (!isValidTab(tab)) continue;

		try {
			const normalizedUrl = normalizeUrl(tab.url);
			normalizedUrls.set(tab.id, normalizedUrl);
		} catch (e) {
			console.log(`无法处理标签页 ${tab.id} 的URL:`, e.message);
			continue;
		}
	}

	return normalizedUrls;
}

// Service Worker 生命周期事件
self.addEventListener('install', (event) => {
	console.log('Service Worker 安装完成');
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	console.log('Service Worker 激活完成');
	event.waitUntil(clients.claim());
});

// 错误处理
self.addEventListener('error', (event) => {
	console.error('Service Worker 错误:', event.message);
});

self.addEventListener('unhandledrejection', (event) => {
	console.error('Service Worker 未处理的 Promise 拒绝:', event.reason);
});

// 优化的防抖函数 - 区分不同类型的操作
function debounce(func, wait, immediate = false) {
	let timeout;
	return function (...args) {
		const context = this;
		const later = function () {
			timeout = null;
			if (!immediate) func.apply(context, args);
		};
		const callNow = immediate && !timeout;
		clearTimeout(timeout);
		timeout = setTimeout(later, wait);
		if (callNow) func.apply(context, args);
	};
}


// 获取最近打开的标签页右侧的索引位置
async function getRecentTabRightIndex() {
	try {
		// 获取所有标签页
		const tabs = await chrome.tabs.query({});

		if (tabs.length === 0) return null;

		// 按最后访问时间排序，找到最近打开的标签页
		const sortedTabs = tabs
			.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));

		if (sortedTabs.length === 0) return null;

		// 返回最近标签页的索引 + 1（在其右侧创建）
		const recentTab = sortedTabs[0];
		return recentTab.index + 1;
	} catch (e) {
		console.error('获取最近标签页右侧索引错误:', e.message);
		return null;
	}
}

// 统一的标签页创建函数
async function createTabWithRecentIndex(url, active = true) {
	try {
		const createOptions = { active };
		if (url) {
			createOptions.url = url;
		}

		const recentRightIndex = await getRecentTabRightIndex();
		if (recentRightIndex !== null) {
			createOptions.index = recentRightIndex;
		}

		return new Promise((resolve, reject) => {
			chrome.tabs.create(createOptions, (tab) => {
				if (chrome.runtime.lastError) {
					const error = chrome.runtime.lastError;
					console.error('创建标签页错误:', error.message);
					reject(error);
				} else {
					console.log('成功创建标签页:', tab.id);
					resolve(tab);
				}
			});
		});
	} catch (e) {
		console.error('创建标签页错误:', e.message);
		throw e;
	}
}

// 重复标签通知跟踪器
const notificationTracker = {
	// 通知记录 - 格式: { [domain]: { lastShown: timestamp, totalShown: number, responses: { close: number, ignore: number } } }
	notifications: {},
	// 忽略的URL - 格式: { [normalizedUrl]: timestamp }
	ignoredUrls: {},
	// 标签页特定记录 - 跟踪每个标签页的最后通知时间
	tabNotifications: new Map(),

	// 使用全局URL标准化函数
	normalizeUrl: normalizeUrl,

	// 检查URL是否应该检测重复
	shouldCheckUrl(url) {
		if (!url) return true;

		const normalizedUrl = this.normalizeUrl(url);

		// 检查URL是否在忽略列表中
		if (normalizedUrl in this.ignoredUrls) {
			// 检查是否已过期（24小时后自动过期）
			const timestamp = this.ignoredUrls[normalizedUrl];
			const now = Date.now();

			if (now - timestamp < 24 * 60 * 60 * 1000) { // 24小时内
				console.log(`URL ${url} 在忽略列表中，跳过检测`);
				return false;
			} else {
				// 已过期，从忽略列表中移除
				delete this.ignoredUrls[normalizedUrl];
			}
		}

		return true;
	},

	// 清理过期忽略的URL
	cleanupIgnoredUrls() {
		const now = Date.now();
		const expireTime = 24 * 60 * 60 * 1000; // 24小时

		Object.keys(this.ignoredUrls).forEach(url => {
			if (now - this.ignoredUrls[url] > expireTime) {
				delete this.ignoredUrls[url];
			}
		});
	},

	// 检查是否可以为特定标签页显示通知
	canNotify(tabId, url, count) {
		// 首先检查URL是否在忽略列表中
		if (!this.shouldCheckUrl(url)) {
			return false;
		}

		// 使用完整URL作为键
		const fullUrl = url;

		const now = Date.now();

		// 如果没有该URL的记录，创建一个
		if (!this.notifications[fullUrl]) {
			this.notifications[fullUrl] = {
				lastShown: 0,
				totalShown: 0,
				responses: { close: 0, ignore: 0 }
			};
		}

		const record = this.notifications[fullUrl];

		// 清理记录中的旧数据
		this.cleanup();

		// 标签页特定的时间检查 - 处理在标签页间切换的情况
		// 如果这个标签页之前收到过通知，有自己的冷却时间
		const tabLastNotified = this.tabNotifications.get(tabId) || 0;
		const tabCooldown = 3 * 60 * 1000; // 标签页特定冷却时间：3分钟

		// 域名通用冷却时间检查（降低为5分钟，更易于在切换标签页后再次收到通知）
		const domainCooldown = 5 * 60 * 1000; // 5分钟

		// 检查标签页特定的冷却时间
		if (now - tabLastNotified < tabCooldown) {
			// 如果有足够多的重复标签页，仍然允许显示
			if (count > 2) {
				// 当有大量重复标签页时，重写冷却时间
				console.log(`标签页 ${tabId} 有 ${count} 个重复标签，允许显示通知`);
			} else {
				console.log(`标签页 ${tabId} 通知冷却中，跳过通知`);
				return false;
			}
		}

		// 检查URL通用冷却时间
		if (now - record.lastShown < domainCooldown) {
			// 为URL提供的阈值判断
			if (count < 1 + Math.min(2, record.responses.close)) {
				console.log(`URL ${fullUrl} 重复标签数量未达阈值，跳过通知`);
				return false;
			}
		}

		// 更新记录
		record.lastShown = now;
		record.totalShown += 1;

		// 更新标签页特定通知时间
		this.tabNotifications.set(tabId, now);

		return true;
	},

	// 记录用户对通知的响应
	recordResponse(fullUrl, action, url) {
		if (!fullUrl) return;

		// 使用完整URL作为键，如果没有该URL的记录，创建一个
		if (!this.notifications[fullUrl]) {
			this.notifications[fullUrl] = {
				lastShown: Date.now(),
				totalShown: 1,
				responses: { close: 0, ignore: 0 }
			};
		}

		// 增加相应动作的计数
		if (action in this.notifications[fullUrl].responses) {
			this.notifications[fullUrl].responses[action] += 1;
		}

		// 如果是忽略操作，将URL添加到忽略列表
		if (action === 'ignore' && url) {
			const normalizedUrl = this.normalizeUrl(url);
			this.ignoredUrls[normalizedUrl] = Date.now();
			console.log(`添加URL到忽略列表: ${url} (标准化为: ${normalizedUrl})`);

			// 保存到session存储
			this.saveIgnoredUrls();
		}

		// 保存通知记录
		this.save();
	},

	// 清理超过24小时的通知记录
	cleanup() {
		const now = Date.now();
		const expiryTime = 24 * 60 * 60 * 1000; // 24小时

		// 清理通知记录
		Object.keys(this.notifications).forEach(domain => {
			const record = this.notifications[domain];
			if (now - record.lastShown > expiryTime) {
				delete this.notifications[domain];
			}
		});

		// 清理忽略的URL列表
		this.cleanupIgnoredUrls();
	},

	// 清理已关闭标签页的记录
	cleanupTabNotifications(closedTabId) {
		if (closedTabId && this.tabNotifications.has(closedTabId)) {
			// 删除指定的标签页记录
			this.tabNotifications.delete(closedTabId);
			console.log(`清理标签页 ${closedTabId} 的通知记录`);
		} else if (!closedTabId) {
			// 定期清理：检查所有标签页是否仍然有效
			chrome.tabs.query({}, tabs => {
				const existingTabIds = new Set(tabs.map(tab => tab.id));

				// 找出并删除不再存在的标签页记录
				for (const tabId of this.tabNotifications.keys()) {
					if (!existingTabIds.has(tabId)) {
						this.tabNotifications.delete(tabId);
						console.log(`清理已关闭标签页 ${tabId} 的记录`);
					}
				}
			});
		}
	},

	// 保存通知记录到storage
	save() {
		chrome.storage.local.set({ notificationRecord: this.notifications }, () => {
			if (chrome.runtime.lastError) {
				console.error('保存通知记录错误:', chrome.runtime.lastError.message);
			}
		});
	},

	// 保存忽略的URL到storage
	saveIgnoredUrls() {
		try {
			// 首选使用session存储（浏览器关闭时自动清除）
			if (chrome.storage && chrome.storage.session) {
				chrome.storage.session.set({ ignoredUrls: this.ignoredUrls }, () => {
					if (chrome.runtime.lastError) {
						console.error('保存忽略URL列表到session存储错误:', chrome.runtime.lastError.message);
						// 回退到local存储，但添加重启标记
						this.saveIgnoredUrlsToLocal();
					}
				});
			} else {
				// 不支持session存储，回退到local存储
				this.saveIgnoredUrlsToLocal();
			}
		} catch (e) {
			console.error('保存忽略URL列表错误:', e.message);
			this.saveIgnoredUrlsToLocal();
		}
	},

	// 备用方案：保存到local存储但添加重启标记
	saveIgnoredUrlsToLocal() {
		const dataWithFlag = {
			ignoredUrls: this.ignoredUrls,
			savedAt: Date.now()  // 记录保存时间，用于判断是否是新的浏览器会话
		};

		chrome.storage.local.set({ ignoredUrlsData: dataWithFlag }, () => {
			if (chrome.runtime.lastError) {
				console.error('保存忽略URL列表到local存储错误:', chrome.runtime.lastError.message);
			}
		});
	},

	// 从storage加载通知记录
	load() {
		chrome.storage.local.get(['notificationRecord', 'ignoredUrlsData', 'lastSessionId', 'isNewBrowserSession'], (result) => {
			if (chrome.runtime.lastError) {
				console.error('加载通知记录错误:', chrome.runtime.lastError.message);
				return;
			}

			if (result.notificationRecord) {
				this.notifications = result.notificationRecord;
			}

			// 生成新的会话ID
			const currentSessionId = Date.now().toString();

			// 检查是否是新的浏览器会话
			let isNewSession = true;

			if (result.isNewBrowserSession) {
				// 如果明确标记为新的浏览器会话，则清除忽略列表
				isNewSession = true;
				console.log('检测到浏览器重启标记，将清除忽略URL列表');
				// 清除标记，避免重复处理
				chrome.storage.local.remove('isNewBrowserSession');
			} else if (result.lastSessionId) {
				// 如果存储的会话ID存在，且当前启动时间与上次相差很远，表示是新会话
				const lastSessionTime = parseInt(result.lastSessionId, 10);
				const timeDiff = currentSessionId - lastSessionTime;

				// 如果时间差小于一定阈值（例如5分钟），可能是扩展刷新而非浏览器重启
				// 5分钟 = 300000毫秒
				isNewSession = timeDiff > 300000;
				console.log(`会话检测: 上次会话时间=${new Date(lastSessionTime).toLocaleString()}, 时间差=${Math.round(timeDiff / 1000)}秒, 是新会话=${isNewSession}`);
			} else {
				console.log('未找到上次会话ID，视为新会话');
			}

			// 保存新的会话ID
			chrome.storage.local.set({ lastSessionId: currentSessionId });

			// 尝试从session存储加载忽略的URL列表
			this.loadIgnoredUrlsFromSession(isNewSession, result.ignoredUrlsData);
		});
	},

	// 从session存储加载忽略的URL列表
	loadIgnoredUrlsFromSession(isNewSession, fallbackData) {
		try {
			// 检查是否支持session存储
			if (chrome.storage && chrome.storage.session) {
				chrome.storage.session.get(['ignoredUrls'], (sessionResult) => {
					if (chrome.runtime.lastError) {
						console.error('加载session存储中的忽略URL列表错误:', chrome.runtime.lastError.message);
						this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
						return;
					}

					if (sessionResult.ignoredUrls) {
						this.ignoredUrls = sessionResult.ignoredUrls;
						console.log('从session存储加载了忽略URL列表');
					} else {
						// session存储中没有数据，尝试备用方案
						this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
					}

					// 加载后立即清理过期的忽略URL
					this.cleanupIgnoredUrls();
				});
			} else {
				// 不支持session存储，使用备用方案
				this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
			}
		} catch (e) {
			console.error('加载忽略URL列表错误:', e.message);
			this.handleFallbackIgnoredUrls(isNewSession, fallbackData);
		}
	},

	// 处理备用的忽略URL数据
	handleFallbackIgnoredUrls(isNewSession, fallbackData) {
		// 如果是新会话，则清空忽略列表（实现浏览器重启后过期）
		if (isNewSession) {
			console.log('检测到新的浏览器会话，清空忽略URL列表');
			this.ignoredUrls = {};
			return;
		}

		// 否则使用备用数据
		if (fallbackData && fallbackData.ignoredUrls) {
			this.ignoredUrls = fallbackData.ignoredUrls;
			console.log('从local存储加载了忽略URL列表');
		}
	}
};

// 初始化通知跟踪器
notificationTracker.load();

// 注册扩展启动事件处理
chrome.runtime.onStartup.addListener(() => {
	console.log('浏览器启动，清理会话数据');
	// 标记为新会话，确保忽略的URL被清除
	chrome.storage.local.set({
		lastSessionId: Date.now().toString(),
		isNewBrowserSession: true
	});
});

// 安装/更新事件处理
chrome.runtime.onInstalled.addListener((details) => {
	console.log('扩展安装或更新:', details.reason);
	// 如果是安装或更新，生成新的会话ID
	chrome.storage.local.set({
		lastSessionId: Date.now().toString(),
		installOrUpdateTime: Date.now()
	});
});

// 定期清理通知记录 - 每小时执行一次
setInterval(() => {
	notificationTracker.cleanup();
	notificationTracker.save();
	notificationTracker.saveIgnoredUrls();
}, 60 * 60 * 1000);

// 检查是否存在空白新标签页
// 如果存在，激活该标签页并返回true，否则返回false
async function checkAndActivateEmptyTab() {
	try {
		// 获取所有标签页
		const tabs = await chrome.tabs.query({});

		// 空白新标签页的可能URL模式
		const newTabUrls = [
			'chrome://newtab/',
			'edge://newtab/',
			'about:newtab',
			'chrome://new-tab-page/',
			'about:blank'
		];

		// 查找符合条件的标签页
		for (const tab of tabs) {
			// 跳过没有URL的标签页
			if (!tab.url) continue;

			// 检查是否是新标签页
			if (newTabUrls.includes(tab.url)) {
				console.log('找到空白新标签页，ID:', tab.id);

				// 激活找到的标签页
				await chrome.tabs.update(tab.id, { active: true });

				// 将窗口置于前台
				if (tab.windowId) {
					await chrome.windows.update(tab.windowId, { focused: true });
				}

				return true; // 表示找到并激活了空白标签页
			}
		}

		// 未找到空白新标签页
		console.log('未找到空白新标签页');
		return false;
	} catch (e) {
		console.error('检查空白标签页错误:', e.message);
		return false;
	}
}

// 检查URL是否已在现有标签页中打开
// 如果找到匹配的标签页，则激活该标签页并返回true
// 如果未找到匹配的标签页，则返回false
async function checkAndActivateExistingTab(url) {
	try {
		// 如果URL为空，可能是想打开新标签页
		if (!url) {
			return await checkAndActivateEmptyTab();
		}

		// 特殊情况：如果请求打开的是新标签页
		const newTabUrls = [
			'chrome://newtab/',
			'edge://newtab/',
			'about:newtab',
			'chrome://new-tab-page/',
			'about:blank'
		];

		if (newTabUrls.includes(url)) {
			return await checkAndActivateEmptyTab();
		}

		// 规范化URL以确保一致的比较
		// 只移除URL末尾的空片段标识符（#）
		const normalizedUrl = new URL(url);
		if (normalizedUrl.hash === '#') {
			normalizedUrl.hash = '';
		}
		const urlToFind = normalizedUrl.toString();

		console.log('检查是否存在相同URL的标签页:', urlToFind);

		// 获取所有标签页
		const tabs = await chrome.tabs.query({});

		// 查找具有相同URL的标签页
		for (const tab of tabs) {
			// 跳过没有URL的标签页
			if (!tab.url) continue;

			// 规范化标签页的URL
			const tabNormalizedUrl = new URL(tab.url);
			if (tabNormalizedUrl.hash === '#') {
				tabNormalizedUrl.hash = '';
			}
			const tabUrl = tabNormalizedUrl.toString();

			// 检查URL是否匹配
			if (tabUrl === urlToFind) {
				console.log('找到相同URL的标签页，ID:', tab.id);

				// 激活找到的标签页
				await chrome.tabs.update(tab.id, { active: true });

				// 将窗口置于前台
				if (tab.windowId) {
					await chrome.windows.update(tab.windowId, { focused: true });
				}

				return true; // 表示找到并激活了现有标签页
			}
		}

		// 未找到匹配的标签页
		console.log('未找到相同URL的标签页');
		return false;
	} catch (e) {
		console.error('检查现有标签页错误:', e.message);
		return false; // 出错时返回false，允许创建新标签页
	}
}

// 智能打开标签页 - 如果标签页已存在则跳转，否则创建新标签页
async function smartCreateTab(url, active = true) {
	try {
		// 获取当前活动标签页的索引，用于在新标签页旁边创建标签页
		let currentTabIndex = null;
		try {
			const currentTabs = await chrome.tabs.query({ active: true, currentWindow: true });
			if (currentTabs.length > 0) {
				const allTabs = await chrome.tabs.query({ currentWindow: true });
				currentTabIndex = allTabs.findIndex(tab => tab.id === currentTabs[0].id);
				if (currentTabIndex !== -1) {
					currentTabIndex += 1; // 在下一个位置创建新标签页
				}
			}
		} catch (e) {
			console.warn('获取当前标签页索引失败:', e.message);
		}

		// 如果URL为空，说明是打开空白新标签页
		if (!url || typeof url !== 'string') {
			console.log('尝试打开空白新标签页');

			// 尝试查找并激活现有的空白标签页
			const existingEmptyTabActivated = await checkAndActivateEmptyTab();

			// 如果没有找到空白标签页，则创建一个
			if (!existingEmptyTabActivated) {
				console.log('创建新的空白标签页');
				try {
					await createTabWithRecentIndex(null, true);
				} catch (e) {
					console.error('创建空白标签页错误:', e.message);
				}
			}

			return;
		}

		// 对于非空URL，执行标准处理
		try {
			// 检查是否是特殊协议URL
			const hasSpecialProtocol = SPECIAL_PROTOCOLS.some(protocol => url.toLowerCase().startsWith(protocol));

			// 如果不是特殊协议URL，则添加https://
			if (!hasSpecialProtocol) {
				url = 'https://' + url;
			}

			// 特殊处理 chrome-extension:// URL 中的双斜杠问题
			if (url.startsWith('chrome-extension://')) {
				url = url.replace(/chrome-extension:\/\/([^\/]*)\/\//, 'chrome-extension://$1/');
				console.log('处理后的扩展URL:', url);
			}

			// 特殊处理新标签页的情况
			if (NEW_TAB_URLS.includes(url)) {
				return await checkAndActivateEmptyTab() || (async () => {
					try {
						return await createTabWithRecentIndex(null, true);
					} catch (e) {
						console.error('创建新标签页错误:', e.message);
						return null;
					}
				})();
			}

			new URL(url); // 验证URL格式
		} catch (e) {
			console.error('URL格式无效:', url, e.message);
			return;
		}

		// 首先检查该URL是否已在现有标签页中打开
		const existingTabActivated = await checkAndActivateExistingTab(url);

		// 如果已经激活了现有标签页，就不需要创建新标签页
		if (existingTabActivated) {
			console.log('已跳转到现有标签页，不创建新标签页');
			return;
		}

		// 新增: 自动关闭重复标签功能
		// 获取设置
		const settings = await chrome.storage.sync.get({
			smartTabHandling: true // 智能打开标签页
		});

		// 未找到现有标签页，创建新标签页
		console.log('创建新标签页:', url);
		try {
			const tab = await createTabWithRecentIndex(url, active);
			console.log('成功创建新标签页:', tab.id);

			// 添加延迟，确保标签页加载完成再检查重复
			// 由于onActivated和onUpdated事件会自动触发检查，这里延长到2秒检查以避免频繁重复检查
			setTimeout(async () => {
				try {
					// 获取当前打开的标签页
					const currentTab = await chrome.tabs.get(tab.id);
					if (!currentTab || !currentTab.url) return;

					// 检查该标签页是否已在冷却期内
					const now = Date.now();
					if (lastCheckedTab.id === tab.id &&
						lastCheckedTab.url === currentTab.url &&
						(now - lastCheckedTab.time) < lastCheckedTab.cooldown) {
						console.log(`新创建标签页 ${tab.id} 已在其他事件中检查过，跳过检查`);
						return;
					}

					// 更新最近检查记录
					lastCheckedTab = {
						id: tab.id,
						url: currentTab.url,
						time: now,
						cooldown: lastCheckedTab.cooldown,
						processedUrls: lastCheckedTab.processedUrls
					};
				} catch (e) {
					console.error('标签页打开后检查重复错误:', e.message);
				}
			}, 2000);
		} catch (e) {
			console.error('创建新标签页错误:', e.message);
		}
	} catch (e) {
		console.error('智能创建标签页错误:', e.message);
	}
}

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	const tabId = sender.tab ? sender.tab.id : null;

	try {
		console.log('收到消息:', message);

		switch (message.action) {
			case 'ping':
				// 简单的ping响应，用于检查扩展上下文是否有效
				sendResponse({ success: true, message: 'pong' });
				break;

			case 'goBack':
				// 后退
				try {
					// 使用 try-catch 捕获可能的错误
					chrome.tabs.goBack(tabId).catch(error => {
						console.log('后退操作错误 (已处理):', error.message);
						// 可以选择向内容脚本发送失败通知
						chrome.tabs.sendMessage(tabId, {
							action: 'navigationFailed',
							operation: 'back',
							error: error.message
						}).catch(() => { });
					});
				} catch (e) {
					console.log('后退操作异常 (已处理):', e.message);
				}
				break;

			case 'goForward':
				// 前进
				try {
					// 使用 try-catch 捕获可能的错误
					chrome.tabs.goForward(tabId).catch(error => {
						console.log('前进操作错误 (已处理):', error.message);
						// 可以选择向内容脚本发送失败通知
						chrome.tabs.sendMessage(tabId, {
							action: 'navigationFailed',
							operation: 'forward',
							error: error.message
						}).catch(() => { });
					});
				} catch (e) {
					console.log('前进操作异常 (已处理):', e.message);
				}
				break;

			case 'scrollUp':
			case 'scrollDown':
			case 'scrollLeft':
			case 'scrollRight':
			case 'scrollToTop':
			case 'scrollToBottom':
				// 这些滚动操作在内容脚本中处理，这里只需转发消息
				// 为所有滚动动作添加动态距离支持
				if (message.action === 'scrollUp' || message.action === 'scrollDown' ||
					message.action === 'scrollLeft' || message.action === 'scrollRight') {
					// 如果消息中包含距离参数，则传递该参数
					safeTabSendMessage(tabId, {
						action: message.action,
						distance: message.distance || 100 // 如果没有提供，则使用默认值100
					});
				} else {
					// 对于其他滚动操作（如scrollToTop和scrollToBottom），保持原样
					safeTabSendMessage(tabId, { action: message.action });
				}
				break;

			case 'duplicateTab':
				chrome.tabs.create({
					url: sender.tab.url,
					index: sender.tab.index + 1,
					active: false
				});
				break;

			case 'closeTab':
				// 关闭当前标签页
				chrome.tabs.remove(tabId);
				break;

			case 'reopenClosedTab':
				// 重新打开关闭的标签页
				chrome.sessions.getRecentlyClosed({ maxResults: 1 }, function (sessions) {
					if (chrome.runtime.lastError) {
						console.log('获取最近关闭标签页错误:', chrome.runtime.lastError.message);
						return;
					}

					if (sessions.length) {
						chrome.sessions.restore();
					}
				});
				break;

			case 'openNewTab':
				// 打开空白新标签页 - 也进行检查是否已有空白标签页
				smartCreateTab(null, true);
				break;

			case 'refresh':
				// 刷新当前页面
				chrome.tabs.reload(tabId);
				break;

			case 'forceRefresh':
				// 强制刷新当前页面（忽略缓存）
				chrome.tabs.reload(tabId, { bypassCache: true });
				break;

			case 'switchToLeftTab':
				// 切换到左侧标签页
				switchToAdjacentTab(tabId, -1);
				break;

			case 'switchToRightTab':
				// 切换到右侧标签页
				switchToAdjacentTab(tabId, 1);
				break;

			case 'stopLoading':
				// 停止加载
				chrome.scripting.executeScript({
					target: { tabId: tabId },
					func: () => { window.stop(); }
				}).then(result => {
					console.log('页面加载已停止');
				}).catch(error => {
					console.error('停止页面加载时出错:', error.message);
					// 错误发生时尝试通过消息传递的方式执行stop
					safeTabSendMessage(tabId, { action: 'stopLoadingInternal' });
				});
				break;

			case 'closeAllTabs':
				// 关闭所有标签页（保留当前标签页）
				closeAllTabs(tabId);
				break;

			case 'newWindow':
				// 新窗口
				chrome.windows.create({ url: 'chrome://newtab/' });
				break;

			case 'newInPrivateWindow':
				// 新建隐私窗口
				chrome.windows.create({
					url: 'chrome://newtab/',
					incognito: true
				});
				break;

			case 'closeOtherTabs':
				// 关闭其他标签页
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
						const tabsToClose = tabs.filter(t => t.id !== tabId);
						if (tabsToClose.length > 0) {
							chrome.tabs.remove(tabsToClose.map(t => t.id));
						}
					});
				});
				break;

			case 'closeTabsToRight':
				// 关闭右侧标签页
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
						const currentTabIndex = tabs.findIndex(t => t.id === tabId);
						const tabsToClose = tabs.filter((t, index) => index > currentTabIndex);
						if (tabsToClose.length > 0) {
							chrome.tabs.remove(tabsToClose.map(t => t.id));
						}
					});
				});
				break;

			case 'toggleFullscreen':
				// 切换全屏
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.windows.get(tab.windowId, (window) => {
						if (chrome.runtime.lastError) {
							console.log('获取窗口信息错误:', chrome.runtime.lastError.message);
							return;
						}
						chrome.windows.update(tab.windowId, {
							state: window.state === 'fullscreen' ? 'normal' : 'fullscreen'
						});
					});
				});
				break;

			case 'closeTabsToLeft':
				// 关闭左侧标签页
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
						const currentTabIndex = tabs.findIndex(t => t.id === tabId);
						const tabsToClose = tabs.filter((t, index) => index < currentTabIndex);
						if (tabsToClose.length > 0) {
							chrome.tabs.remove(tabsToClose.map(t => t.id));
						}
					});
				});
				break;

			case 'reloadAllTabs':
				// 全部重新加载
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
						tabs.forEach(t => {
							// 跳过特殊页面（如chrome://页面）
							if (t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://')) {
								chrome.tabs.reload(t.id);
							}
						});
					});
				});
				break;

			case 'togglePinTab':
				// 固定/取消固定标签页
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.tabs.update(tabId, { pinned: !tab.pinned });
				});
				break;

			case 'toggleMuteTab':
				// 静音/取消静音标签页
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.tabs.update(tabId, { muted: !tab.mutedInfo.muted });
				});
				break;

			case 'muteOtherTabs':
				// 静音其他标签页
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.tabs.query({ windowId: tab.windowId }, (tabs) => {
						tabs.forEach(t => {
							if (t.id !== tabId) {
								chrome.tabs.update(t.id, { muted: true });
							}
						});
					});
				});
				break;

			case 'toggleMaximize':
				// 最大化/还原窗口
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.windows.get(tab.windowId, (window) => {
						if (chrome.runtime.lastError) {
							console.log('获取窗口信息错误:', chrome.runtime.lastError.message);
							return;
						}
						chrome.windows.update(tab.windowId, {
							state: window.state === 'maximized' ? 'normal' : 'maximized'
						});
					});
				});
				break;

			case 'minimizeWindow':
				// 最小化窗口
				chrome.tabs.get(tabId, (tab) => {
					if (chrome.runtime.lastError) {
						console.log('获取标签页信息错误:', chrome.runtime.lastError.message);
						return;
					}
					chrome.windows.update(tab.windowId, { state: 'minimized' });
				});
				break;

			case 'superDrag':
				// 处理超级拖拽
				handleSuperDrag(message);
				sendResponse({ success: true });
				break;

			// 在后台打开标签页
			case 'openTabInBackground':
				if (message.url) {
					smartCreateTab(message.url, false);
				}
				sendResponse({ success: true });
				break;

			case 'fetchUrlContent':
				fetchUrlContent(message.url)
					.then(content => {
						sendResponse({ success: true, content: content });
					})
					.catch(error => {
						console.warn('获取URL内容失败:', error);
						sendResponse({ success: false, error: error.message });
					});
				return true; // 异步响应

			case 'resolveRedirectUrl':
				resolveRedirectUrl(message.url)
					.then(finalUrl => {
						sendResponse({ success: true, finalUrl: finalUrl });
					})
					.catch(error => {
						console.warn('解析重定向URL失败:', error);
						sendResponse({ success: false, error: error.message });
					});
				return true; // 异步响应

			case 'openInNewTab':
				// 使用统一的标签页创建函数
				createTabWithRecentIndex(message.url, true)
					.then(() => {
						sendResponse({ success: true });
					})
					.catch(e => {
						console.error('在新标签页中打开URL错误:', e.message);
						sendResponse({ success: false, error: e.message });
					});
				return true;

			case 'scrollToLeft':
				// 通过content script执行滚动操作
				chrome.tabs.sendMessage(sender.tab.id, { action: 'scrollToLeft' }, (response) => {
					sendResponse(response || { success: true });
				});
				return true;

			case 'scrollToRight':
				// 通过content script执行滚动操作
				chrome.tabs.sendMessage(sender.tab.id, { action: 'scrollToRight' }, (response) => {
					sendResponse(response || { success: true });
				});
				return true;

			default:
				console.log('未知消息类型:', message.action);
				sendResponse({ success: false, error: '未知消息类型' });
				break;
		}

		// 如果没有在case中发送响应，这里发送默认响应
		if (message.action !== 'ping' && message.action !== 'superDrag') {
			sendResponse({ success: true });
		}
	} catch (e) {
		console.error('处理消息错误:', e.message);
		sendResponse({ success: false, error: e.message });
	}

	return true;
});

// 安全地向标签页发送消息
function safeTabSendMessage(tabId, message, silent = false) {
	if (!tabId) return Promise.resolve(false);

	return new Promise((resolve) => {
		try {
			// 首先检查标签页是否有效
			chrome.tabs.get(tabId, (tab) => {
				// 如果标签页不存在
				if (chrome.runtime.lastError) {
					if (!silent) {
						console.log('目标标签页不存在:', chrome.runtime.lastError.message);
					}
					resolve(false);
					return;
				}

				// 检查URL是否是Chrome内部页面
				if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:'))) {
					if (!silent) {
						console.log('无法向Chrome内部页面发送消息:', tab.url);
					}
					resolve(false);
					return;
				}

				// 然后尝试发送消息
				chrome.tabs.sendMessage(tabId, message, (response) => {
					if (chrome.runtime.lastError) {
						if (!silent) {
							console.log('发送消息时出错:', chrome.runtime.lastError.message);
						}
						resolve(false);
					} else {
						resolve(response || true);
					}
				});
			});
		} catch (e) {
			if (!silent) {
				console.error('向标签页发送消息异常:', e.message);
			}
			resolve(false);
		}
	});
}

// 切换到相邻标签页
function switchToAdjacentTab(currentTabId, offset) {
	try {
		chrome.tabs.query({ currentWindow: true }, function (tabs) {
			if (chrome.runtime.lastError) {
				console.error('查询标签页错误:', chrome.runtime.lastError.message);
				return;
			}

			if (tabs.length <= 1) return;

			let currentIndex = -1;
			for (let i = 0; i < tabs.length; i++) {
				if (tabs[i].id === currentTabId) {
					currentIndex = i;
					break;
				}
			}

			if (currentIndex === -1) return;

			// 计算目标索引，处理循环
			let targetIndex = (currentIndex + offset) % tabs.length;
			if (targetIndex < 0) targetIndex = tabs.length - 1;

			// 获取目标标签页ID
			const targetTabId = tabs[targetIndex].id;

			// 激活目标标签页
			chrome.tabs.update(targetTabId, { active: true }, () => {
				if (chrome.runtime.lastError) {
					console.error('激活标签页错误:', chrome.runtime.lastError.message);
					return;
				}

				// 标签页切换后进行重复检查（通过onActivated事件自动处理）
			});
		});
	} catch (e) {
		console.error('切换标签页错误:', e.message);
	}
}

// 关闭所有标签页（保留当前标签页）
function closeAllTabs(currentTabId) {
	try {
		chrome.tabs.query({ currentWindow: true }, function (tabs) {
			if (chrome.runtime.lastError) {
				console.error('查询标签页错误:', chrome.runtime.lastError.message);
				return;
			}

			for (const tab of tabs) {
				if (tab.id !== currentTabId) {
					chrome.tabs.remove(tab.id);
				}
			}
		});
	} catch (e) {
		console.error('关闭所有标签页错误:', e.message);
	}
}

// 处理超级拖拽
function handleSuperDrag(message) {
	try {
		console.log('收到超级拖拽请求:', message);

		// 获取用户设置的搜索引擎URL
		chrome.storage.sync.get({
			dragSearchEngine: 'https://www.google.com/search?q={q}'
		}, (settings) => {
			// 提取搜索引擎URL
			let searchEngineUrl = settings.dragSearchEngine || 'https://www.google.com/search?q={q}';

			// 根据明确指定的actionType决定标签页打开方式
			// 如果没有actionType，默认使用后台打开
			let openInForeground;

			if (message.actionType) {
				openInForeground = message.actionType === 'foreground';
			} else {
				// 默认使用后台打开，完全依赖用户设置
				openInForeground = false;
			}

			if (message.type === 'text') {
				// 处理文本拖拽
				if (openInForeground) {
					try {
						// 前台打开：首先尝试使用chrome.search.query API
						chrome.search.query({
							text: message.text,
							disposition: 'NEW_TAB'
						}, () => {
							if (chrome.runtime.lastError) {
								console.error('使用搜索API错误:', chrome.runtime.lastError.message);
								// 回退到自定义搜索引擎作为备选方案
								let finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
								smartCreateTab(finalSearchUrl, true);
							}
						});
					} catch (e) {
						// 如果chrome.search.query API不可用，使用自定义搜索引擎
						console.error('搜索API不可用:', e.message);
						let finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
						smartCreateTab(finalSearchUrl, true);
					}
				} else {
					// 后台打开：使用自定义搜索引擎（search API不支持后台打开）
					let finalSearchUrl = searchEngineUrl.replace('{q}', encodeURIComponent(message.text));
					smartCreateTab(finalSearchUrl, false);
				}
				return;
			}

			// 检查URL是否有效
			if (!message.url || typeof message.url !== 'string') {
				console.error('超级拖拽URL无效:', message.url);
				return;
			}

			// 尝试解析URL，确保它是有效的
			let url = message.url;
			try {
				// 如果URL不是以http或https开头，尝试添加https://
				// 保持与smartCreateTab函数处理一致
				if (!url.startsWith('http://') && !url.startsWith('https://') &&
					!url.startsWith('data:') && !url.startsWith('chrome://') &&
					!url.startsWith('edge://') && !url.startsWith('about:')) {
					url = 'https://' + url;
				}
				new URL(url); // 验证URL格式

				// 处理不同类型的拖拽
				if (message.type === 'link' || message.type === 'image') {
					// 处理链接或图片拖拽 - 前台或后台打开取决于拖拽方向和设置
					console.log(`准备${openInForeground ? '前台' : '后台'}打开链接:`, url);
					smartCreateTab(url, openInForeground);
				}
			} catch (e) {
				console.error('超级拖拽URL格式无效:', url, e.message);
				return;
			}
		});
	} catch (e) {
		console.error('处理超级拖拽错误:', e.message);
	}
}

// 获取URL内容
async function fetchUrlContent(url) {
	try {
		console.log('尝试获取URL内容:', url);

		// 直接获取URL内容，不使用代理
		const response = await fetch(url, {
			method: 'GET',
			credentials: 'omit',
			redirect: 'follow',
			headers: {
				'User-Agent': navigator.userAgent,
				'Accept': 'text/html,application/xhtml+xml,application/xml',
				'X-Requested-With': 'XMLHttpRequest'
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP error! Status: ${response.status}`);
		}

		// 获取内容类型
		const contentType = response.headers.get('Content-Type') || 'text/html';
		const content = await response.text();

		console.log('成功获取URL内容，长度:', content.length);

		// 返回内容
		return content;
	} catch (error) {
		console.error('获取URL内容失败:', error.message);
		throw new Error(`获取内容失败: ${error.message}`);
	}
}

// 解析重定向URL
async function resolveRedirectUrl(url) {
	// 使用fetch的HEAD请求检查重定向
	try {
		const response = await fetch(url, {
			method: 'HEAD',
			redirect: 'follow'
		});

		// 获取最终URL
		return response.url;
	} catch (error) {
		// 如果失败，返回原始URL
		console.warn('解析重定向URL失败:', error);
		return url;
	}
}

// 监听标签页关闭事件，清理标签页通知记录
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
	// 标签页关闭时清理对应的记录
	notificationTracker.cleanupTabNotifications(tabId);
});

// 定期清理全部标签页记录，防止可能的内存泄漏
setInterval(() => {
	notificationTracker.cleanupTabNotifications();
}, 15 * 60 * 1000); // 每15分钟清理一次

// 扩展安装或更新时的处理
chrome.runtime.onInstalled.addListener((details) => {
	try {
		if (details.reason === 'install') {
			// 首次安装 - 直接使用 chrome.tabs.create 打开欢迎页面
			const welcomeUrl = chrome.runtime.getURL('welcome.html');
			console.log('欢迎页面URL:', welcomeUrl);

			// 使用统一的标签页创建函数
			createTabWithRecentIndex(welcomeUrl, true)
				.catch(e => {
					console.error('创建欢迎页面错误:', e.message);
				});

			// 为所有已打开的标签页注入内容脚本，使扩展立即生效
			injectContentScriptsToAllTabs();
		} else if (details.reason === 'update') {
			// 扩展更新时，也为所有已打开的标签页注入内容脚本
			injectContentScriptsToAllTabs();
		}

	} catch (e) {
		console.error('扩展安装/更新处理错误:', e.message);
	}
});

// 向所有已打开的标签页注入内容脚本
async function injectContentScriptsToAllTabs() {
	try {
		// 查询所有标签页
		const tabs = await chrome.tabs.query({});

		for (const tab of tabs) {
			// 跳过扩展页面和特殊页面
			if (!tab.url || IGNORED_PROTOCOLS.some(protocol => tab.url.startsWith(protocol))) {
				continue;
			}

			// 注入内容脚本
			try {
				console.log(`向标签页 ${tab.id} (${tab.url}) 注入内容脚本`);

				await chrome.scripting.executeScript({
					target: { tabId: tab.id },
					files: ['content.js']
				});

				console.log(`标签页 ${tab.id} 注入脚本成功`);
			} catch (injectionError) {
				console.error(`标签页 ${tab.id} 注入脚本失败:`, injectionError.message);
			}
		}

		console.log('所有标签页注入脚本完成');
	} catch (e) {
		console.error('注入内容脚本到所有标签页失败:', e.message);
	}
}