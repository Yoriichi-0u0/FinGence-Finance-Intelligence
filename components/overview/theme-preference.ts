/** The same preference is read before hydration and by the interactive theme store. */
export const THEME_STORAGE_KEY = 'fingence-theme-v1';
export const themeInitialization = `(() => { try {
    let theme;
    try { theme = localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)}); } catch {}
    if (theme !== 'light' && theme !== 'dark') theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.fingenceTheme = theme;
} catch {} })();`;
