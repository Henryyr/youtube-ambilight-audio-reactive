import { getVersion } from './libs/utils';
import {
  appendErrorStack,
  setErrorHandler,
  setWarning,
  wrapErrorHandler,
} from './libs/generic';
import { defaultCrashOptions, storage } from './libs/storage';
import SentryReporter, {
  setCrashOptions,
  setVersion,
} from './libs/errors/sentry-reporter';
import { injectedScript } from './libs/messaging/injected';

setErrorHandler((ex) => SentryReporter.captureException(ex));

// Relay audio-reactive-level from background to content-main (which runs in page context)
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'audio-reactive-level') {
    document.dispatchEvent(new CustomEvent('ytal-audio-level', { detail: message }));
  } else if (message?.type === 'audio-reactive-status') {
    document.dispatchEvent(new CustomEvent('ytal-audio-status', { detail: message.active }));
  }
});


injectedScript.addMessageListener('error', (injectedEx) => {
  const ex = new Error(injectedEx.message);
  ex.name = injectedEx.name;
  ex.stack = injectedEx.stack;
  if (injectedEx.details) ex.details = injectedEx.details;

  SentryReporter.captureException(ex);
});

const setResourceWarning = (url) => {
  setWarning(
    url
      ? `Failed to load a resource. Reload the webpage to try it again. 
This can happen after you have updated the extension. 

Or if this happens often, view the error in your browser's DevTools javascript console panel. 
Tip: Look for errors about this url: ${url}`
      : `Failed to load the extension on this webpage because it has been updated, reloaded or uninstalled. 
Reload the webpage to reload the extension.`
  );
};

const waitForHtmlElement = async () => {
  if (document.documentElement) return;

  const stack = new Error().stack;
  await new Promise((resolve, reject) => {
    try {
      const observer = new MutationObserver(
        wrapErrorHandler(
          function onHtmlElementMutation() {
            if (!document.documentElement) return;

            observer.disconnect();
            resolve();
          }.bind(this),
          true
        )
      );
      observer.observe(document, { childList: true });
    } catch (ex) {
      appendErrorStack(stack, ex);
      reject(ex);
    }
  });
};

const waitForHeadElement = async () => {
  if (document.head) return;

  const stack = new Error().stack;
  await new Promise((resolve, reject) => {
    try {
      const observer = new MutationObserver(
        wrapErrorHandler(
          function onHeadElementMutation() {
            if (!document.head) return;

            observer.disconnect();
            resolve();
          }.bind(this),
          true
        )
      );
      observer.observe(document.documentElement, { childList: true });
    } catch (ex) {
      appendErrorStack(stack, ex);
      reject(ex);
    }
  });
};


wrapErrorHandler(async function loadContentScript() {
  const version = getVersion();
  setVersion(version);

  let crashOptions = defaultCrashOptions;
  try {
    crashOptions = (await storage.get('crashOptions')) || defaultCrashOptions;
    setCrashOptions(crashOptions);
  } catch (ex) {
    SentryReporter.captureException(ex);
  }

  storage.addListener(function storageListener(changes) {
    if (!changes.crashOptions?.newValue) return;

    const crashOptions = changes.crashOptions.newValue;
    setCrashOptions(crashOptions);
  });

  await waitForHtmlElement();
  await waitForHeadElement();

  // const addWebGLLint = () => {
  //   const s = document.createElement('script')
  //   s.src = 'https://greggman.github.io/webgl-lint/webgl-lint.js'
  //   s.setAttribute('data-gman-debug-helper', JSON.stringify({
  //     throwOnError: false
  //   }))
  //   s.onerror = function injectScriptOnError(ex) {
  //     console.error(ex)
  //   }.bind(this)
  //   document.body.appendChild(s)
  // }
  // addWebGLLint()

  if (!chrome?.runtime?.id) {
    setResourceWarning();
    return;
  }

  let loaded = true;
  if (!loaded) return;
})();
