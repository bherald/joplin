// Manages a global hook that ExtendedWebView calls to decrypt resource files
// referenced in note HTML before display. Set once during app startup on Android.

export let htmlDecryptHook: ((html: string)=> Promise<string>) | null = null;

export const setHtmlDecryptHook = (hook: ((html: string)=> Promise<string>) | null) => {
	htmlDecryptHook = hook;
};
