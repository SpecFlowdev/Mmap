/* Переводы интерфейса / UI translations */
const I18N = {
  ru: {
    'brand.sub': 'карта переводов кошелька',
    'nav.settings': 'Настройки',
    'search.placeholder': 'Вставьте адрес кошелька (BTC, ETH, TRON, SOL, LTC, DOGE…)',
    'search.scan': 'Отследить',
    'search.tokens': 'Токены',
    'search.usd': 'Оценка в USD',
    'chain.auto': 'Определить автоматически',
    'saved.title': 'Отслеживаемые кошельки',
    'saved.export': 'Экспорт',
    'saved.import': 'Импорт',
    'saved.remove': 'Убрать из списка',
    'saved.added': 'Кошелёк сохранён в список отслеживания',
    'saved.imported': 'Импортировано кошельков: {n}',
    'saved.badfile': 'Файл не похож на список кошельков Mmap',
    'saved.clear': 'Очистить список',
    'saved.confirm': 'Убрать все сохранённые кошельки?',
    'stat.txs': 'Переводов',
    'stat.in': 'Получено',
    'stat.out': 'Отправлено',
    'stat.net': 'Итого',
    'stat.peers': 'Контрагентов',
    'stat.assets': 'Активов',
    'view.flow': 'Поток',
    'view.mind': 'Майндмап',
    'view.time': 'Хронология',
    'flow.in': 'Откуда пришло · {v}',
    'flow.out': 'Куда ушло · {v}',
    'flow.rest': 'ещё {n} адресов',
    'view.graph': 'Граф',
    'group.asset': 'По активам',
    'group.dir': 'По направлению',
    'mm.more': 'ещё {n}',
    'graph.title': 'Схема переводов',
    'graph.fit': 'По размеру',
    'graph.export': 'PNG',
    'graph.all': 'Все активы',
    'legend.self': 'Ваш кошелёк',
    'legend.in': 'Отправитель',
    'legend.out': 'Получатель',
    'list.title': 'Переводы',
    'list.filter': 'Фильтр…',
    'list.all': 'Все',
    'list.onlyin': 'Входящие',
    'list.onlyout': 'Исходящие',
    'list.csv': 'CSV',
    'th.date': 'Дата',
    'th.dir': 'Тип',
    'th.peer': 'Контрагент',
    'th.amount': 'Сумма',
    'th.usd': 'USD',
    'th.tx': 'Транзакция',
    'peers.title': 'Топ контрагентов',
    'peers.hint': 'клик — выбрать',
    'sel.title': 'Схема по кошелькам',
    'sel.all': 'Все кошельки',
    'sel.count': 'выбрано: {n}',
    'peers.txs': 'операций',
    'settings.title': 'Настройки API',
    'settings.note': 'Ключи хранятся только в вашем браузере (localStorage) и отправляются напрямую в API провайдера.',
    'settings.etherscan': 'Etherscan API-ключ (все EVM-сети)',
    'settings.trongrid': 'TronGrid API-ключ (необязательно)',
    'settings.solana': 'Solana RPC URL',
    'settings.save': 'Сохранить',
    'settings.saved': 'Настройки сохранены',
    'foot.note': 'Данные берутся из публичных обозревателей блокчейна. Приложение не хранит ваши ключи на сервере.',
    'msg.loading': 'Загружаем переводы…',
    'msg.prices': 'Получаем курсы валют…',
    'msg.empty': 'По этому адресу переводов не найдено',
    'msg.noaddress': 'Введите адрес кошелька',
    'msg.unknown': 'Не удалось определить сеть по адресу — выберите её вручную',
    'msg.needkey': 'Для этой сети нужен Etherscan API-ключ — добавьте его в настройках',
    'msg.done': 'Найдено переводов: {n}',
    'msg.error': 'Ошибка: {e}',
    'dir.in': 'Вход',
    'dir.out': 'Выход',
    'detected': 'Сеть определена: {c}',
    'nothing': 'Ничего не найдено',
    'showing': 'Показано {n} из {t}'
  },
  en: {
    'brand.sub': 'wallet transfer map',
    'nav.settings': 'Settings',
    'search.placeholder': 'Paste a wallet address (BTC, ETH, TRON, SOL, LTC, DOGE…)',
    'search.scan': 'Trace',
    'search.tokens': 'Tokens',
    'search.usd': 'USD estimate',
    'chain.auto': 'Detect automatically',
    'saved.title': 'Watched wallets',
    'saved.export': 'Export',
    'saved.import': 'Import',
    'saved.remove': 'Remove from list',
    'saved.added': 'Wallet saved to the watch list',
    'saved.imported': 'Wallets imported: {n}',
    'saved.badfile': 'That file is not an Mmap wallet list',
    'saved.clear': 'Clear list',
    'saved.confirm': 'Remove every saved wallet?',
    'stat.txs': 'Transfers',
    'stat.in': 'Received',
    'stat.out': 'Sent',
    'stat.net': 'Net',
    'stat.peers': 'Counterparties',
    'stat.assets': 'Assets',
    'view.flow': 'Flow',
    'view.mind': 'Mindmap',
    'view.time': 'Timeline',
    'flow.in': 'Came from · {v}',
    'flow.out': 'Went to · {v}',
    'flow.rest': '{n} more addresses',
    'view.graph': 'Graph',
    'group.asset': 'By asset',
    'group.dir': 'By direction',
    'mm.more': '{n} more',
    'graph.title': 'Transfer map',
    'graph.fit': 'Fit',
    'graph.export': 'PNG',
    'graph.all': 'All assets',
    'legend.self': 'Your wallet',
    'legend.in': 'Sender',
    'legend.out': 'Recipient',
    'list.title': 'Transfers',
    'list.filter': 'Filter…',
    'list.all': 'All',
    'list.onlyin': 'Incoming',
    'list.onlyout': 'Outgoing',
    'list.csv': 'CSV',
    'th.date': 'Date',
    'th.dir': 'Type',
    'th.peer': 'Counterparty',
    'th.amount': 'Amount',
    'th.usd': 'USD',
    'th.tx': 'Transaction',
    'peers.title': 'Top counterparties',
    'peers.hint': 'click to select',
    'sel.title': 'Map for wallets',
    'sel.all': 'All wallets',
    'sel.count': 'selected: {n}',
    'peers.txs': 'transfers',
    'settings.title': 'API settings',
    'settings.note': 'Keys are stored in your browser only (localStorage) and sent straight to the provider API.',
    'settings.etherscan': 'Etherscan API key (all EVM chains)',
    'settings.trongrid': 'TronGrid API key (optional)',
    'settings.solana': 'Solana RPC URL',
    'settings.save': 'Save',
    'settings.saved': 'Settings saved',
    'foot.note': 'Data comes from public blockchain explorers. This app never stores your keys on a server.',
    'msg.loading': 'Loading transfers…',
    'msg.prices': 'Fetching prices…',
    'msg.empty': 'No transfers found for this address',
    'msg.noaddress': 'Enter a wallet address',
    'msg.unknown': 'Could not detect the chain — pick it manually',
    'msg.needkey': 'This chain needs an Etherscan API key — add it in settings',
    'msg.done': 'Transfers found: {n}',
    'msg.error': 'Error: {e}',
    'dir.in': 'In',
    'dir.out': 'Out',
    'detected': 'Detected chain: {c}',
    'nothing': 'Nothing found',
    'showing': 'Showing {n} of {t}'
  }
};

let currentLang = localStorage.getItem('mmap.lang') || ((navigator.language || '').startsWith('ru') ? 'ru' : 'en');

function t(key, vars) {
  let s = (I18N[currentLang] && I18N[currentLang][key]) || I18N.en[key] || key;
  if (vars) for (const k in vars) s = s.replace('{' + k + '}', vars[k]);
  return s;
}

function setLang(lang) {
  currentLang = I18N[lang] ? lang : 'en';
  localStorage.setItem('mmap.lang', currentLang);
  document.documentElement.lang = currentLang;
  applyI18n();
  document.dispatchEvent(new CustomEvent('langchange'));
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(';').forEach(pair => {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    });
  });
  document.querySelectorAll('#lang-switch .seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === currentLang);
  });
}
