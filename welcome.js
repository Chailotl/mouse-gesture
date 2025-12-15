// 禁用所有控制台日志
console.log = function () { };
console.error = function () { };
console.warn = function () { };
console.info = function () { };
console.debug = function () { };

// 获取i18n消息
function getI18nMessage(messageName, fallback = '') {
	try {
		const message = chrome.i18n.getMessage(messageName);
		return message || fallback;
	} catch (error) {
		console.error('获取i18n消息失败:', error.message);
		return fallback;
	}
}

// 获取浏览器语言
function getBrowserLanguage() {
	// 获取浏览器语言设置
	const browserLang = navigator.language.toLowerCase();

	// 支持的语言列表及其对应的locale映射
	const languageMap = {
		'zh_CN': 'zh_CN',
		'zh_TW': 'zh_TW',
		'zh_HK': 'zh_TW',
		'zh_MO': 'zh_TW',
		'zh': 'zh_CN',
		'en_US': 'en_US',
		'es': 'es',
		'fr': 'fr',
		'de': 'de',
		'pt_BR': 'pt_BR',
		'ru': 'ru',
		'ko': 'ko',
		'hi': 'hi',
		'ar': 'ar',
		'bn': 'bn',
		'ja': 'ja',
		'id': 'id',
		'th': 'th',
		'vi': 'vi',
		'sw': 'sw',
		'tr': 'tr',
		'ur': 'ur',
		'nl': 'nl',
		'it': 'it',
		'uk': 'uk',
		'pl': 'pl',
		'cs': 'cs',
		'da': 'da',
		'sv': 'sv',
		'no': 'no',
		'fi': 'fi',
		'et': 'et'
	};

	// 精确匹配完整locale
	if (languageMap[browserLang]) {
		return languageMap[browserLang];
	}

	// 匹配语言代码前缀
	const langPrefix = browserLang.split('-')[0];
	if (languageMap[langPrefix]) {
		return languageMap[langPrefix];
	}

	// 默认使用英文
	return 'en_US';
}

// 当前语言
let currentLang = getBrowserLanguage();

// 更新界面文本
function updateUIText(lang) {
	document.querySelectorAll('[data-i18n]').forEach(element => {
		const key = element.getAttribute('data-i18n');
		element.textContent = getI18nMessage(key, element.textContent);
	});

	// 更新页面标题
	document.title = getI18nMessage('welcomeTitle', document.title);

	// 更新当前语言
	currentLang = lang;

	// 尝试保存语言设置到存储中
	try {
		if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
			chrome.storage.sync.set({ language: lang }, () => {
				if (chrome.runtime.lastError) {
					console.log('Save language setting error:', chrome.runtime.lastError.message);
				}
			});
		} else {
			// 如果Chrome API不可用，则使用localStorage作为备选
			localStorage.setItem('mouseGestureLanguage', lang);
		}
	} catch (e) {
		console.log('Save language setting exception:', e.message);
		// 恢复使用localStorage
		try {
			localStorage.setItem('mouseGestureLanguage', lang);
		} catch (e2) {
			console.log('localStorage storage failed:', e2.message);
		}
	}
}

// 加载语言设置
function loadLanguage() {
	try {
		// 首先尝试从Chrome存储加载
		if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
			chrome.storage.sync.get(['language'], (result) => {
				try {
					if (chrome.runtime.lastError) {
						fallbackLoadLanguage();
						return;
					}

					const lang = result.language || getBrowserLanguage();
					updateUIText(lang);
				} catch (e) {
					console.log('加载语言设置异常:', e.message);
					fallbackLoadLanguage();
				}
			});
		} else {
			// 如果Chrome API不可用，则回退
			fallbackLoadLanguage();
		}
	} catch (e) {
		console.log('Chrome API访问异常:', e.message);
		fallbackLoadLanguage();
	}
}

// 回退方案：从localStorage加载或使用浏览器语言
function fallbackLoadLanguage() {
	try {
		const savedLang = localStorage.getItem('mouseGestureLanguage');
		const lang = savedLang || getBrowserLanguage();
		updateUIText(lang);
	} catch (e) {
		console.log('回退加载语言异常:', e.message);
		// 如果一切都失败了，至少使用浏览器语言
		updateUIText(getBrowserLanguage());
	}
}

// 显示扩展版本号
function displayExtensionVersion() {
	const versionText = document.getElementById('version-text');
	const iconContainer = document.getElementById('icon-container');

	// 从manifest获取版本号
	if (typeof chrome !== 'undefined' && chrome.runtime) {
		try {
			const manifest = chrome.runtime.getManifest();

			// 设置版本号
			if (versionText && manifest && manifest.version) {
				versionText.textContent = `v${manifest.version}`;
			}

			// 设置图标
			if (iconContainer) {
				const iconUrl = chrome.runtime.getURL('images/icon16.png');
				iconContainer.innerHTML = `<img src="${iconUrl}" class="footer-icon" alt="icon">`;
			}
		} catch (e) {
			console.log('获取版本号或图标异常:', e.message);
			// 如果无法获取版本号，不显示版本信息
			if (versionText) {
				versionText.textContent = '';
			}

			// 使用相对路径作为备选
			if (iconContainer) {
				iconContainer.innerHTML = '<img src="images/icon16.png" class="footer-icon" alt="icon">';
			}
		}
	} else {
		// 备选方案：直接使用相对路径
		if (iconContainer) {
			iconContainer.innerHTML = '<img src="images/icon16.png" class="footer-icon" alt="icon">';
		}
	}
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', loadLanguage);
document.addEventListener('DOMContentLoaded', displayExtensionVersion);