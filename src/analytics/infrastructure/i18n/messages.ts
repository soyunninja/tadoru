import type { BreakdownDimension } from '../../domain/report/Breakdown.ts';
import type { RangeKey } from '../http/views/overviewPage.ts';
import type { Locale } from './Locale.ts';

/**
 * Every piece of user-facing copy in the dashboard, in one typed shape. This
 * interface is the contract: `en`, `es` and `ja` below are each checked
 * against it, so leaving out a key in any one of them — or misspelling a
 * dimension in a `Record<BreakdownDimension, string>` — is a compile error,
 * never a silent fallback to the English string or the key name.
 *
 * Code, identifiers and comments stay English throughout this file, per
 * AGENTS.md; only the string *values* below are translated.
 */
export interface Messages {
  readonly common: {
    readonly logOut: string;
    readonly allSites: string;
  };
  readonly login: {
    readonly pageTitle: string;
    readonly heading: string;
    readonly passwordLabel: string;
    readonly submit: string;
    /** Shown for both a wrong password and an exhausted rate limit — the two must read identically so neither leaks which one happened. */
    readonly genericError: string;
  };
  readonly sites: {
    readonly pageTitle: string;
    readonly heading: string;
    readonly empty: string;
    /** Introduces the single tracking snippet shown once below the list, explaining why one serves every site. */
    readonly snippetIntro: string;
    /** Shown for a configured site that has never received an event: says so, and what to check. */
    readonly activityNever: string;
    /** `lastSeen` is a pre-formatted relative time ("2 minutes ago"); `totalEvents` a pre-formatted count. */
    /**
     * Takes the raw count as well as its formatted form: only the locale knows
     * its own plural rules, and "1 events total" on the very line meant to
     * reassure a new operator reads as sloppiness.
     */
    readonly activitySummary: (lastSeen: string, totalEvents: string, count: number) => string;
    /** Label for the button that copies the tracking snippet to the clipboard. */
    readonly copyButton: string;
    /** Shown briefly next to the copy button after it is used, confirming the copy succeeded. */
    readonly copiedConfirmation: string;
  };
  readonly notFound: {
    readonly pageTitle: string;
    readonly heading: string;
    readonly body: string;
    readonly backLink: string;
  };
  readonly overview: {
    readonly pageTitle: (site: string) => string;
    readonly rangeLabels: Readonly<Record<RangeKey, string>>;
    /** The empty-state sentence, up to (not including) the trailing link — see `noDataLinkText`. */
    readonly noData: string;
    readonly noDataLinkText: string;
    /** One extra sentence in the empty state: ingest buffers writes and flushes about once a second, so a just-sent test visit will not appear on an immediate reload. */
    readonly ingestDelay: string;
  };
  readonly headline: {
    readonly visitors: string;
    readonly pageviews: string;
    readonly sessions: string;
    readonly bounceRate: string;
    readonly avgEngagement: string;
    /**
     * The "unique visitors do not add up across the tables" caveat required by
     * specs/dashboard/spec.md. Rendered as a collapsed disclosure: an operator
     * who never wonders never has to read it, and one who does finds the answer
     * where the doubt arises rather than in documentation.
     */
    readonly caveatSummary: string;
    readonly caveatBody: string;
  };
  readonly breakdown: {
    readonly titles: Readonly<Record<BreakdownDimension, string>>;
    readonly emptyKeyLabels: Readonly<Record<BreakdownDimension, string>>;
    readonly noDataForRange: string;
    readonly visitorsColumn: string;
    readonly pageviewsColumn: string;
  };
  readonly chart: {
    readonly noData: string;
    readonly ariaLabel: string;
    readonly tableSummary: string;
    readonly dateColumn: string;
    readonly visitorsColumn: string;
    /** The accessible per-bar tooltip. `date` stays the raw ISO string (unambiguous); only `visitors` is pre-formatted for the locale. */
    readonly barTitle: (date: string, visitors: string) => string;
  };
  readonly country: {
    readonly unknown: string;
  };
  readonly footer: {
    readonly prefix: string;
    readonly linkText: string;
    readonly version: (version: string) => string;
  };
}

const en: Messages = {
  common: {
    logOut: 'Log out',
    allSites: 'All sites',
  },
  login: {
    pageTitle: 'Log in — Tadoru',
    heading: 'Tadoru admin',
    passwordLabel: 'Password',
    submit: 'Log in',
    genericError: 'Invalid password or too many attempts. Please try again.',
  },
  sites: {
    pageTitle: 'Sites — Tadoru',
    heading: 'Sites',
    empty: 'No sites configured.',
    snippetIntro: 'The same snippet goes on every one of your sites — each is recognised by its own domain, so there is no key to swap.',
    activityNever:
      'No events received yet. Check that the tracking snippet is installed, and that the domain matches exactly — including "www." if your site uses it.',
    activitySummary: (lastSeen, totalEvents, count) =>
      `Last event ${lastSeen} · ${totalEvents} ${count === 1 ? 'event' : 'events'} total`,
    copyButton: 'Copy',
    copiedConfirmation: 'Copied!',
  },
  notFound: {
    pageTitle: 'Not found — Tadoru',
    heading: 'Not found',
    body: 'That site is not configured.',
    backLink: 'Back to sites',
  },
  overview: {
    pageTitle: (site) => `${site} — Tadoru`,
    rangeLabels: { today: 'Today', '7d': '7 days', '30d': '30 days', '12m': '12 months' },
    noData:
      'No data yet for this site in this range. Check that the tracking snippet is installed on your site — the exact snippet is shown on',
    noDataLinkText: 'the sites page',
    ingestDelay: 'A new visit can take a second or two to show up here, so try reloading before assuming it failed.',
  },
  headline: {
    visitors: 'Visitors',
    pageviews: 'Pageviews',
    sessions: 'Sessions',
    bounceRate: 'Bounce rate',
    avgEngagement: 'Avg. engagement',
    caveatSummary: "Why don't the tables match these totals?",
    caveatBody:
      'Say Ana visits your site and reads two pages: the home page and the blog. In the Visitors box above she counts as 1, because she is one person. In the pages table she appears twice, once for each page she read. So adding up a table\'s Visitors column gives more than the total above. Each table answers "how many people saw this one thing" — the tables are not meant to be added up.',
  },
  breakdown: {
    titles: {
      path: 'Top pages',
      referrer: 'Referrer sources',
      country: 'Countries',
      device: 'Devices',
      browser: 'Browsers',
      os: 'Operating systems',
      campaign: 'Campaigns',
      screen: 'Screen size',
      language: 'Languages',
      colorScheme: 'Colour scheme',
    },
    emptyKeyLabels: {
      path: '(none)',
      referrer: 'Direct',
      country: '(unknown)',
      device: '(unknown)',
      browser: '(unknown)',
      os: '(unknown)',
      campaign: '(none)',
      screen: '(unknown)',
      language: '(unknown)',
      colorScheme: '(unknown)',
    },
    noDataForRange: 'No data for this range.',
    visitorsColumn: 'Visitors',
    pageviewsColumn: 'Pageviews',
  },
  chart: {
    noData: 'No data to chart.',
    ariaLabel: 'Visitors per day',
    tableSummary: 'Visitors per day (table)',
    dateColumn: 'Date',
    visitorsColumn: 'Visitors',
    barTitle: (date, visitors) => `${date}: ${visitors} visitors`,
  },
  country: {
    unknown: 'Unknown',
  },
  footer: {
    prefix: 'Tadoru is free software:',
    linkText: 'view the corresponding source',
    version: (version) => `(version ${version})`,
  },
};

const es: Messages = {
  common: {
    logOut: 'Cerrar sesión',
    allSites: 'Todos los sitios',
  },
  login: {
    pageTitle: 'Iniciar sesión — Tadoru',
    heading: 'Administración de Tadoru',
    passwordLabel: 'Contraseña',
    submit: 'Iniciar sesión',
    genericError: 'Contraseña incorrecta o demasiados intentos. Inténtalo de nuevo.',
  },
  sites: {
    pageTitle: 'Sitios — Tadoru',
    heading: 'Sitios',
    empty: 'No hay sitios configurados.',
    snippetIntro: 'El mismo snippet vale para todos tus sitios: cada uno se reconoce por su propio dominio, así que no hay ninguna clave que cambiar.',
    activityNever:
      'Todavía no se ha recibido ningún evento. Comprueba que el fragmento de seguimiento esté instalado y que el dominio coincida exactamente — incluyendo «www.» si tu sitio lo usa.',
    activitySummary: (lastSeen, totalEvents, count) =>
      `Último evento ${lastSeen} · ${totalEvents} ${count === 1 ? 'evento' : 'eventos'} en total`,
    copyButton: 'Copiar',
    copiedConfirmation: '¡Copiado!',
  },
  notFound: {
    pageTitle: 'No encontrado — Tadoru',
    heading: 'No encontrado',
    body: 'Ese sitio no está configurado.',
    backLink: 'Volver a los sitios',
  },
  overview: {
    pageTitle: (site) => `${site} — Tadoru`,
    rangeLabels: { today: 'Hoy', '7d': '7 días', '30d': '30 días', '12m': '12 meses' },
    noData:
      'Todavía no hay datos para este sitio en este rango. Comprueba que el fragmento de seguimiento esté instalado en tu sitio — el fragmento exacto se muestra en',
    noDataLinkText: 'la página de sitios',
    ingestDelay:
      'Una visita nueva puede tardar uno o dos segundos en aparecer aquí, así que prueba a recargar antes de asumir que falló.',
  },
  headline: {
    visitors: 'Visitantes',
    pageviews: 'Páginas vistas',
    sessions: 'Sesiones',
    bounceRate: 'Tasa de rebote',
    avgEngagement: 'Interacción media',
    caveatSummary: '¿Por qué las tablas no cuadran con estos totales?',
    caveatBody:
      'Imagina que Ana entra en tu web y mira dos páginas: el inicio y el blog. En el recuadro Visitantes de arriba, Ana cuenta como 1, porque es una sola persona. En la tabla de páginas aparece dos veces, una por cada página que miró. Por eso, si sumas la columna Visitantes de una tabla, te sale más que el total de arriba. Cada tabla responde a «cuánta gente vio esta cosa concreta»; no están hechas para sumarse.',
  },
  breakdown: {
    titles: {
      path: 'Páginas más vistas',
      referrer: 'Fuentes de referencia',
      country: 'Países',
      device: 'Dispositivos',
      browser: 'Navegadores',
      os: 'Sistemas operativos',
      campaign: 'Campañas',
      screen: 'Tamaño de pantalla',
      language: 'Idiomas',
      colorScheme: 'Esquema de color',
    },
    emptyKeyLabels: {
      path: '(ninguna)',
      referrer: 'Directo',
      country: '(desconocido)',
      device: '(desconocido)',
      browser: '(desconocido)',
      os: '(desconocido)',
      campaign: '(ninguna)',
      screen: '(desconocido)',
      language: '(desconocido)',
      colorScheme: '(desconocido)',
    },
    noDataForRange: 'No hay datos para este rango.',
    visitorsColumn: 'Visitantes',
    pageviewsColumn: 'Páginas vistas',
  },
  chart: {
    noData: 'No hay datos para graficar.',
    ariaLabel: 'Visitantes por día',
    tableSummary: 'Visitantes por día (tabla)',
    dateColumn: 'Fecha',
    visitorsColumn: 'Visitantes',
    barTitle: (date, visitors) => `${date}: ${visitors} visitantes`,
  },
  country: {
    unknown: 'Desconocido',
  },
  footer: {
    prefix: 'Tadoru es software libre:',
    linkText: 'ver el código fuente correspondiente',
    version: (version) => `(versión ${version})`,
  },
};

const ja: Messages = {
  common: {
    logOut: 'ログアウト',
    allSites: 'すべてのサイト',
  },
  login: {
    pageTitle: 'ログイン — Tadoru',
    heading: 'Tadoru 管理画面',
    passwordLabel: 'パスワード',
    submit: 'ログイン',
    genericError: 'パスワードが間違っているか、試行回数が多すぎます。もう一度お試しください。',
  },
  sites: {
    pageTitle: 'サイト — Tadoru',
    heading: 'サイト',
    empty: '設定されているサイトはありません。',
    snippetIntro: 'すべてのサイトに、同じスニペットを貼ります。サイトはそれぞれ自分のドメインで識別されるため、差し替えるキーはありません。',
    activityNever:
      'まだイベントを受信していません。トラッキングスニペットが設置されているか、ドメインが「www.」を含めて正確に一致しているかを確認してください。',
    activitySummary: (lastSeen, totalEvents) => `最終イベント: ${lastSeen} ・ 合計 ${totalEvents} 件`,
    copyButton: 'コピー',
    copiedConfirmation: 'コピーしました',
  },
  notFound: {
    pageTitle: '見つかりません — Tadoru',
    heading: '見つかりません',
    body: 'そのサイトは設定されていません。',
    backLink: 'サイト一覧に戻る',
  },
  overview: {
    pageTitle: (site) => `${site} — Tadoru`,
    rangeLabels: { today: '今日', '7d': '7日間', '30d': '30日間', '12m': '12か月' },
    noData:
      'この範囲のデータはまだありません。サイトにトラッキングスニペットが設置されているか確認してください — 正確なスニペットは次のページに表示されています',
    noDataLinkText: 'サイト一覧ページ',
    ingestDelay: '新しい訪問が表示されるまで1〜2秒かかることがあるので、失敗したと判断する前に再読み込みしてみてください。',
  },
  headline: {
    visitors: '訪問者数',
    pageviews: 'ページビュー',
    sessions: 'セッション数',
    bounceRate: '直帰率',
    avgEngagement: '平均エンゲージメント',
    caveatSummary: '表の数値が上の合計と一致しないのはなぜですか。',
    caveatBody:
      '例えば、アナさんがサイトを訪れ、トップページとブログの2ページを見たとします。上の「訪問者数」では、アナさんは1人なので1と数えます。ページ別の表では、見た2ページそれぞれに1行ずつ、つまり2回現れます。そのため表の「訪問者数」を合計すると、上の合計より大きくなります。各表は「それぞれのページを何人が見たか」を示すもので、合計するためのものではありません。',
  },
  breakdown: {
    titles: {
      path: '人気ページ',
      referrer: '参照元',
      country: '国',
      device: 'デバイス',
      browser: 'ブラウザ',
      os: 'OS',
      campaign: 'キャンペーン',
      screen: '画面サイズ',
      language: '言語',
      colorScheme: '配色',
    },
    emptyKeyLabels: {
      path: '（なし）',
      referrer: '直接アクセス',
      country: '（不明）',
      device: '（不明）',
      browser: '（不明）',
      os: '（不明）',
      campaign: '（なし）',
      screen: '（不明）',
      language: '（不明）',
      colorScheme: '（不明）',
    },
    noDataForRange: 'この範囲のデータはありません。',
    visitorsColumn: '訪問者数',
    pageviewsColumn: 'ページビュー',
  },
  chart: {
    noData: 'グラフ化するデータがありません。',
    ariaLabel: '日別訪問者数',
    tableSummary: '日別訪問者数（表）',
    dateColumn: '日付',
    visitorsColumn: '訪問者数',
    barTitle: (date, visitors) => `${date}：訪問者数 ${visitors} 人`,
  },
  country: {
    unknown: '不明',
  },
  footer: {
    prefix: 'Tadoru はフリーソフトウェアです：',
    linkText: '対応するソースコードを見る',
    version: (version) => `（バージョン ${version}）`,
  },
};

export const CATALOGUE: Readonly<Record<Locale, Messages>> = { en, es, ja };

export function messagesFor(locale: Locale): Messages {
  return CATALOGUE[locale];
}
