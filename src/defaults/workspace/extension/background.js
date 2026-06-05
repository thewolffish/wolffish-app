var browserPolyfill$1 = { exports: {} }, browserPolyfill = browserPolyfill$1.exports, hasRequiredBrowserPolyfill;
function requireBrowserPolyfill() {
  return hasRequiredBrowserPolyfill || (hasRequiredBrowserPolyfill = 1, (function(e, s) {
    (function(t, n) {
      n(e);
    })(typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : browserPolyfill, function(t) {
      if (!(globalThis.chrome && globalThis.chrome.runtime && globalThis.chrome.runtime.id))
        throw new Error("This script should only be loaded in a browser extension.");
      if (globalThis.browser && globalThis.browser.runtime && globalThis.browser.runtime.id)
        t.exports = globalThis.browser;
      else {
        const n = "The message port closed before a response was received.", a = (i) => {
          const g = {
            alarms: {
              clear: {
                minArgs: 0,
                maxArgs: 1
              },
              clearAll: {
                minArgs: 0,
                maxArgs: 0
              },
              get: {
                minArgs: 0,
                maxArgs: 1
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            bookmarks: {
              create: {
                minArgs: 1,
                maxArgs: 1
              },
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getChildren: {
                minArgs: 1,
                maxArgs: 1
              },
              getRecent: {
                minArgs: 1,
                maxArgs: 1
              },
              getSubTree: {
                minArgs: 1,
                maxArgs: 1
              },
              getTree: {
                minArgs: 0,
                maxArgs: 0
              },
              move: {
                minArgs: 2,
                maxArgs: 2
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              removeTree: {
                minArgs: 1,
                maxArgs: 1
              },
              search: {
                minArgs: 1,
                maxArgs: 1
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            },
            browserAction: {
              disable: {
                minArgs: 0,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              enable: {
                minArgs: 0,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              getBadgeBackgroundColor: {
                minArgs: 1,
                maxArgs: 1
              },
              getBadgeText: {
                minArgs: 1,
                maxArgs: 1
              },
              getPopup: {
                minArgs: 1,
                maxArgs: 1
              },
              getTitle: {
                minArgs: 1,
                maxArgs: 1
              },
              openPopup: {
                minArgs: 0,
                maxArgs: 0
              },
              setBadgeBackgroundColor: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setBadgeText: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setIcon: {
                minArgs: 1,
                maxArgs: 1
              },
              setPopup: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setTitle: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              }
            },
            browsingData: {
              remove: {
                minArgs: 2,
                maxArgs: 2
              },
              removeCache: {
                minArgs: 1,
                maxArgs: 1
              },
              removeCookies: {
                minArgs: 1,
                maxArgs: 1
              },
              removeDownloads: {
                minArgs: 1,
                maxArgs: 1
              },
              removeFormData: {
                minArgs: 1,
                maxArgs: 1
              },
              removeHistory: {
                minArgs: 1,
                maxArgs: 1
              },
              removeLocalStorage: {
                minArgs: 1,
                maxArgs: 1
              },
              removePasswords: {
                minArgs: 1,
                maxArgs: 1
              },
              removePluginData: {
                minArgs: 1,
                maxArgs: 1
              },
              settings: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            commands: {
              getAll: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            contextMenus: {
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              removeAll: {
                minArgs: 0,
                maxArgs: 0
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            },
            cookies: {
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getAll: {
                minArgs: 1,
                maxArgs: 1
              },
              getAllCookieStores: {
                minArgs: 0,
                maxArgs: 0
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              set: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            devtools: {
              inspectedWindow: {
                eval: {
                  minArgs: 1,
                  maxArgs: 2,
                  singleCallbackArg: !1
                }
              },
              panels: {
                create: {
                  minArgs: 3,
                  maxArgs: 3,
                  singleCallbackArg: !0
                },
                elements: {
                  createSidebarPane: {
                    minArgs: 1,
                    maxArgs: 1
                  }
                }
              }
            },
            downloads: {
              cancel: {
                minArgs: 1,
                maxArgs: 1
              },
              download: {
                minArgs: 1,
                maxArgs: 1
              },
              erase: {
                minArgs: 1,
                maxArgs: 1
              },
              getFileIcon: {
                minArgs: 1,
                maxArgs: 2
              },
              open: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              pause: {
                minArgs: 1,
                maxArgs: 1
              },
              removeFile: {
                minArgs: 1,
                maxArgs: 1
              },
              resume: {
                minArgs: 1,
                maxArgs: 1
              },
              search: {
                minArgs: 1,
                maxArgs: 1
              },
              show: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              }
            },
            extension: {
              isAllowedFileSchemeAccess: {
                minArgs: 0,
                maxArgs: 0
              },
              isAllowedIncognitoAccess: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            history: {
              addUrl: {
                minArgs: 1,
                maxArgs: 1
              },
              deleteAll: {
                minArgs: 0,
                maxArgs: 0
              },
              deleteRange: {
                minArgs: 1,
                maxArgs: 1
              },
              deleteUrl: {
                minArgs: 1,
                maxArgs: 1
              },
              getVisits: {
                minArgs: 1,
                maxArgs: 1
              },
              search: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            i18n: {
              detectLanguage: {
                minArgs: 1,
                maxArgs: 1
              },
              getAcceptLanguages: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            identity: {
              launchWebAuthFlow: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            idle: {
              queryState: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            management: {
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              },
              getSelf: {
                minArgs: 0,
                maxArgs: 0
              },
              setEnabled: {
                minArgs: 2,
                maxArgs: 2
              },
              uninstallSelf: {
                minArgs: 0,
                maxArgs: 1
              }
            },
            notifications: {
              clear: {
                minArgs: 1,
                maxArgs: 1
              },
              create: {
                minArgs: 1,
                maxArgs: 2
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              },
              getPermissionLevel: {
                minArgs: 0,
                maxArgs: 0
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            },
            pageAction: {
              getPopup: {
                minArgs: 1,
                maxArgs: 1
              },
              getTitle: {
                minArgs: 1,
                maxArgs: 1
              },
              hide: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setIcon: {
                minArgs: 1,
                maxArgs: 1
              },
              setPopup: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              setTitle: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              },
              show: {
                minArgs: 1,
                maxArgs: 1,
                fallbackToNoCallback: !0
              }
            },
            permissions: {
              contains: {
                minArgs: 1,
                maxArgs: 1
              },
              getAll: {
                minArgs: 0,
                maxArgs: 0
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              request: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            runtime: {
              getBackgroundPage: {
                minArgs: 0,
                maxArgs: 0
              },
              getPlatformInfo: {
                minArgs: 0,
                maxArgs: 0
              },
              openOptionsPage: {
                minArgs: 0,
                maxArgs: 0
              },
              requestUpdateCheck: {
                minArgs: 0,
                maxArgs: 0
              },
              sendMessage: {
                minArgs: 1,
                maxArgs: 3
              },
              sendNativeMessage: {
                minArgs: 2,
                maxArgs: 2
              },
              setUninstallURL: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            sessions: {
              getDevices: {
                minArgs: 0,
                maxArgs: 1
              },
              getRecentlyClosed: {
                minArgs: 0,
                maxArgs: 1
              },
              restore: {
                minArgs: 0,
                maxArgs: 1
              }
            },
            storage: {
              local: {
                clear: {
                  minArgs: 0,
                  maxArgs: 0
                },
                get: {
                  minArgs: 0,
                  maxArgs: 1
                },
                getBytesInUse: {
                  minArgs: 0,
                  maxArgs: 1
                },
                remove: {
                  minArgs: 1,
                  maxArgs: 1
                },
                set: {
                  minArgs: 1,
                  maxArgs: 1
                }
              },
              managed: {
                get: {
                  minArgs: 0,
                  maxArgs: 1
                },
                getBytesInUse: {
                  minArgs: 0,
                  maxArgs: 1
                }
              },
              sync: {
                clear: {
                  minArgs: 0,
                  maxArgs: 0
                },
                get: {
                  minArgs: 0,
                  maxArgs: 1
                },
                getBytesInUse: {
                  minArgs: 0,
                  maxArgs: 1
                },
                remove: {
                  minArgs: 1,
                  maxArgs: 1
                },
                set: {
                  minArgs: 1,
                  maxArgs: 1
                }
              }
            },
            tabs: {
              captureVisibleTab: {
                minArgs: 0,
                maxArgs: 2
              },
              create: {
                minArgs: 1,
                maxArgs: 1
              },
              detectLanguage: {
                minArgs: 0,
                maxArgs: 1
              },
              discard: {
                minArgs: 0,
                maxArgs: 1
              },
              duplicate: {
                minArgs: 1,
                maxArgs: 1
              },
              executeScript: {
                minArgs: 1,
                maxArgs: 2
              },
              get: {
                minArgs: 1,
                maxArgs: 1
              },
              getCurrent: {
                minArgs: 0,
                maxArgs: 0
              },
              getZoom: {
                minArgs: 0,
                maxArgs: 1
              },
              getZoomSettings: {
                minArgs: 0,
                maxArgs: 1
              },
              goBack: {
                minArgs: 0,
                maxArgs: 1
              },
              goForward: {
                minArgs: 0,
                maxArgs: 1
              },
              highlight: {
                minArgs: 1,
                maxArgs: 1
              },
              insertCSS: {
                minArgs: 1,
                maxArgs: 2
              },
              move: {
                minArgs: 2,
                maxArgs: 2
              },
              query: {
                minArgs: 1,
                maxArgs: 1
              },
              reload: {
                minArgs: 0,
                maxArgs: 2
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              removeCSS: {
                minArgs: 1,
                maxArgs: 2
              },
              sendMessage: {
                minArgs: 2,
                maxArgs: 3
              },
              setZoom: {
                minArgs: 1,
                maxArgs: 2
              },
              setZoomSettings: {
                minArgs: 1,
                maxArgs: 2
              },
              update: {
                minArgs: 1,
                maxArgs: 2
              }
            },
            topSites: {
              get: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            webNavigation: {
              getAllFrames: {
                minArgs: 1,
                maxArgs: 1
              },
              getFrame: {
                minArgs: 1,
                maxArgs: 1
              }
            },
            webRequest: {
              handlerBehaviorChanged: {
                minArgs: 0,
                maxArgs: 0
              }
            },
            windows: {
              create: {
                minArgs: 0,
                maxArgs: 1
              },
              get: {
                minArgs: 1,
                maxArgs: 2
              },
              getAll: {
                minArgs: 0,
                maxArgs: 1
              },
              getCurrent: {
                minArgs: 0,
                maxArgs: 1
              },
              getLastFocused: {
                minArgs: 0,
                maxArgs: 1
              },
              remove: {
                minArgs: 1,
                maxArgs: 1
              },
              update: {
                minArgs: 2,
                maxArgs: 2
              }
            }
          };
          if (Object.keys(g).length === 0)
            throw new Error("api-metadata.json has not been included in browser-polyfill");
          class A extends WeakMap {
            constructor(o, l = void 0) {
              super(l), this.createItem = o;
            }
            get(o) {
              return this.has(o) || this.set(o, this.createItem(o)), super.get(o);
            }
          }
          const f = (r) => r && typeof r == "object" && typeof r.then == "function", m = (r, o) => (...l) => {
            i.runtime.lastError ? r.reject(new Error(i.runtime.lastError.message)) : o.singleCallbackArg || l.length <= 1 && o.singleCallbackArg !== !1 ? r.resolve(l[0]) : r.resolve(l);
          }, R = (r) => r == 1 ? "argument" : "arguments", b = (r, o) => function(d, ...h) {
            if (h.length < o.minArgs)
              throw new Error(`Expected at least ${o.minArgs} ${R(o.minArgs)} for ${r}(), got ${h.length}`);
            if (h.length > o.maxArgs)
              throw new Error(`Expected at most ${o.maxArgs} ${R(o.maxArgs)} for ${r}(), got ${h.length}`);
            return new Promise((_, w) => {
              if (o.fallbackToNoCallback)
                try {
                  d[r](...h, m({
                    resolve: _,
                    reject: w
                  }, o));
                } catch (c) {
                  console.warn(`${r} API method doesn't seem to support the callback parameter, falling back to call it without a callback: `, c), d[r](...h), o.fallbackToNoCallback = !1, o.noCallback = !0, _();
                }
              else o.noCallback ? (d[r](...h), _()) : d[r](...h, m({
                resolve: _,
                reject: w
              }, o));
            });
          }, x = (r, o, l) => new Proxy(o, {
            apply(d, h, _) {
              return l.call(h, r, ..._);
            }
          });
          let O = Function.call.bind(Object.prototype.hasOwnProperty);
          const C = (r, o = {}, l = {}) => {
            let d = /* @__PURE__ */ Object.create(null), h = {
              has(w, c) {
                return c in r || c in d;
              },
              get(w, c, S) {
                if (c in d)
                  return d[c];
                if (!(c in r))
                  return;
                let E = r[c];
                if (typeof E == "function")
                  if (typeof o[c] == "function")
                    E = x(r, r[c], o[c]);
                  else if (O(l, c)) {
                    let T = b(c, l[c]);
                    E = x(r, r[c], T);
                  } else
                    E = E.bind(r);
                else if (typeof E == "object" && E !== null && (O(o, c) || O(l, c)))
                  E = C(E, o[c], l[c]);
                else if (O(l, "*"))
                  E = C(E, o[c], l["*"]);
                else
                  return Object.defineProperty(d, c, {
                    configurable: !0,
                    enumerable: !0,
                    get() {
                      return r[c];
                    },
                    set(T) {
                      r[c] = T;
                    }
                  }), E;
                return d[c] = E, E;
              },
              set(w, c, S, E) {
                return c in d ? d[c] = S : r[c] = S, !0;
              },
              defineProperty(w, c, S) {
                return Reflect.defineProperty(d, c, S);
              },
              deleteProperty(w, c) {
                return Reflect.deleteProperty(d, c);
              }
            }, _ = Object.create(r);
            return new Proxy(_, h);
          }, v = (r) => ({
            addListener(o, l, ...d) {
              o.addListener(r.get(l), ...d);
            },
            hasListener(o, l) {
              return o.hasListener(r.get(l));
            },
            removeListener(o, l) {
              o.removeListener(r.get(l));
            }
          }), y = new A((r) => typeof r != "function" ? r : function(l) {
            const d = C(l, {}, {
              getContent: {
                minArgs: 0,
                maxArgs: 0
              }
            });
            r(d);
          }), u = new A((r) => typeof r != "function" ? r : function(l, d, h) {
            let _ = !1, w, c = new Promise((I) => {
              w = function(p) {
                _ = !0, I(p);
              };
            }), S;
            try {
              S = r(l, d, w);
            } catch (I) {
              S = Promise.reject(I);
            }
            const E = S !== !0 && f(S);
            if (S !== !0 && !E && !_)
              return !1;
            const T = (I) => {
              I.then((p) => {
                h(p);
              }, (p) => {
                let N;
                p && (p instanceof Error || typeof p.message == "string") ? N = p.message : N = "An unexpected error occurred", h({
                  __mozWebExtensionPolyfillReject__: !0,
                  message: N
                });
              }).catch((p) => {
                console.error("Failed to send onMessage rejected reply", p);
              });
            };
            return T(E ? S : c), !0;
          }), W = ({
            reject: r,
            resolve: o
          }, l) => {
            i.runtime.lastError ? i.runtime.lastError.message === n ? o() : r(new Error(i.runtime.lastError.message)) : l && l.__mozWebExtensionPolyfillReject__ ? r(new Error(l.message)) : o(l);
          }, P = (r, o, l, ...d) => {
            if (d.length < o.minArgs)
              throw new Error(`Expected at least ${o.minArgs} ${R(o.minArgs)} for ${r}(), got ${d.length}`);
            if (d.length > o.maxArgs)
              throw new Error(`Expected at most ${o.maxArgs} ${R(o.maxArgs)} for ${r}(), got ${d.length}`);
            return new Promise((h, _) => {
              const w = W.bind(null, {
                resolve: h,
                reject: _
              });
              d.push(w), l.sendMessage(...d);
            });
          }, L = {
            devtools: {
              network: {
                onRequestFinished: v(y)
              }
            },
            runtime: {
              onMessage: v(u),
              onMessageExternal: v(u),
              sendMessage: P.bind(null, "sendMessage", {
                minArgs: 1,
                maxArgs: 3
              })
            },
            tabs: {
              sendMessage: P.bind(null, "sendMessage", {
                minArgs: 2,
                maxArgs: 3
              })
            }
          }, B = {
            clear: {
              minArgs: 1,
              maxArgs: 1
            },
            get: {
              minArgs: 1,
              maxArgs: 1
            },
            set: {
              minArgs: 1,
              maxArgs: 1
            }
          };
          return g.privacy = {
            network: {
              "*": B
            },
            services: {
              "*": B
            },
            websites: {
              "*": B
            }
          }, C(i, L, g);
        };
        t.exports = a(chrome);
      }
    });
  })(browserPolyfill$1)), browserPolyfill$1.exports;
}
requireBrowserPolyfill();
const DEFAULT_PORT = 23151, LOG_PREFIX = "[Wolffish]", HEARTBEAT_INTERVAL_MS = 15e3, COMMAND_TIMEOUT_MS = 3e4, CONTENT_SCRIPT_PING_TIMEOUT_MS = 500, WolffishCommands = {
  // Navigation
  BROWSER_NAVIGATE: "browser_navigate",
  BROWSER_BACK: "browser_back",
  BROWSER_FORWARD: "browser_forward",
  BROWSER_RELOAD: "browser_reload",
  // Page Interaction
  BROWSER_CLICK: "browser_click",
  BROWSER_TYPE: "browser_type",
  BROWSER_SELECT: "browser_select",
  BROWSER_HOVER: "browser_hover",
  BROWSER_SCROLL: "browser_scroll",
  BROWSER_FOCUS: "browser_focus",
  BROWSER_KEYPRESS: "browser_keypress",
  BROWSER_DRAG_DROP: "browser_drag_drop",
  BROWSER_FILE_UPLOAD: "browser_file_upload",
  // Page Reading
  BROWSER_READ_PAGE: "browser_read_page",
  BROWSER_QUERY_SELECTOR: "browser_query_selector",
  BROWSER_GET_ATTRIBUTE: "browser_get_attribute",
  BROWSER_GET_VALUE: "browser_get_value",
  BROWSER_GET_URL: "browser_get_url",
  BROWSER_GET_PAGE_INFO: "browser_get_page_info",
  // Tab Management
  BROWSER_TABS_LIST: "browser_tabs_list",
  BROWSER_TAB_OPEN: "browser_tab_open",
  BROWSER_TAB_CLOSE: "browser_tab_close",
  BROWSER_TAB_SWITCH: "browser_tab_switch",
  BROWSER_TAB_DUPLICATE: "browser_tab_duplicate",
  BROWSER_TAB_MOVE: "browser_tab_move",
  // Window Management
  BROWSER_WINDOWS_LIST: "browser_windows_list",
  BROWSER_WINDOW_OPEN: "browser_window_open",
  BROWSER_WINDOW_CLOSE: "browser_window_close",
  BROWSER_WINDOW_RESIZE: "browser_window_resize",
  // Screenshots & Visual
  BROWSER_SCREENSHOT: "browser_screenshot",
  BROWSER_PDF: "browser_pdf",
  // Cookies & Storage
  BROWSER_COOKIES_GET: "browser_cookies_get",
  BROWSER_COOKIES_SET: "browser_cookies_set",
  BROWSER_COOKIES_REMOVE: "browser_cookies_remove",
  BROWSER_STORAGE_GET: "browser_storage_get",
  BROWSER_STORAGE_SET: "browser_storage_set",
  // Clipboard
  BROWSER_CLIPBOARD_READ: "browser_clipboard_read",
  BROWSER_CLIPBOARD_WRITE: "browser_clipboard_write",
  // Downloads
  BROWSER_DOWNLOAD: "browser_download",
  // JavaScript Execution
  BROWSER_EXECUTE_JS: "browser_execute_js",
  // Wait & Polling
  BROWSER_WAIT_FOR: "browser_wait_for",
  BROWSER_WAIT_FOR_NAVIGATION: "browser_wait_for_navigation",
  BROWSER_WAIT_FOR_NETWORK_IDLE: "browser_wait_for_network_idle",
  // Notifications
  BROWSER_NOTIFY: "browser_notify"
}, CONTENT_SCRIPT_COMMANDS = /* @__PURE__ */ new Set([
  WolffishCommands.BROWSER_CLICK,
  WolffishCommands.BROWSER_TYPE,
  WolffishCommands.BROWSER_SELECT,
  WolffishCommands.BROWSER_HOVER,
  WolffishCommands.BROWSER_SCROLL,
  WolffishCommands.BROWSER_FOCUS,
  WolffishCommands.BROWSER_KEYPRESS,
  WolffishCommands.BROWSER_DRAG_DROP,
  WolffishCommands.BROWSER_FILE_UPLOAD,
  WolffishCommands.BROWSER_READ_PAGE,
  WolffishCommands.BROWSER_QUERY_SELECTOR,
  WolffishCommands.BROWSER_GET_ATTRIBUTE,
  WolffishCommands.BROWSER_GET_VALUE,
  WolffishCommands.BROWSER_GET_PAGE_INFO,
  WolffishCommands.BROWSER_STORAGE_GET,
  WolffishCommands.BROWSER_STORAGE_SET,
  WolffishCommands.BROWSER_CLIPBOARD_READ,
  WolffishCommands.BROWSER_CLIPBOARD_WRITE,
  WolffishCommands.BROWSER_WAIT_FOR,
  WolffishCommands.BROWSER_WAIT_FOR_NETWORK_IDLE
]), SERVICE_WORKER_COMMANDS = /* @__PURE__ */ new Set([
  WolffishCommands.BROWSER_NAVIGATE,
  WolffishCommands.BROWSER_BACK,
  WolffishCommands.BROWSER_FORWARD,
  WolffishCommands.BROWSER_RELOAD,
  WolffishCommands.BROWSER_TABS_LIST,
  WolffishCommands.BROWSER_TAB_OPEN,
  WolffishCommands.BROWSER_TAB_CLOSE,
  WolffishCommands.BROWSER_TAB_SWITCH,
  WolffishCommands.BROWSER_TAB_DUPLICATE,
  WolffishCommands.BROWSER_TAB_MOVE,
  WolffishCommands.BROWSER_WINDOWS_LIST,
  WolffishCommands.BROWSER_WINDOW_OPEN,
  WolffishCommands.BROWSER_WINDOW_CLOSE,
  WolffishCommands.BROWSER_WINDOW_RESIZE,
  WolffishCommands.BROWSER_SCREENSHOT,
  WolffishCommands.BROWSER_PDF,
  WolffishCommands.BROWSER_COOKIES_GET,
  WolffishCommands.BROWSER_COOKIES_SET,
  WolffishCommands.BROWSER_COOKIES_REMOVE,
  WolffishCommands.BROWSER_DOWNLOAD,
  WolffishCommands.BROWSER_EXECUTE_JS,
  WolffishCommands.BROWSER_WAIT_FOR_NAVIGATION,
  WolffishCommands.BROWSER_NOTIFY,
  WolffishCommands.BROWSER_GET_URL
]), api$1 = globalThis.chrome ?? globalThis.browser, log = (...e) => {
  console.log(LOG_PREFIX, ...e);
}, logError = (...e) => {
  console.error(LOG_PREFIX, ...e);
}, isFirefox = () => typeof globalThis.browser < "u", sendToContentScript = async (e, s) => {
  var t;
  return (t = api$1 == null ? void 0 : api$1.tabs) == null ? void 0 : t.sendMessage(e, s);
}, pingContentScript = async (e) => {
  var s;
  try {
    const t = {
      source: "service-worker",
      target: "content-script",
      payload: { type: "ping" }
    }, n = await Promise.race([
      (s = api$1 == null ? void 0 : api$1.tabs) == null ? void 0 : s.sendMessage(e, t),
      new Promise((a, i) => setTimeout(() => i(new Error("timeout")), CONTENT_SCRIPT_PING_TIMEOUT_MS))
    ]);
    return n && n.type === "pong";
  } catch {
    return !1;
  }
}, ensureContentScriptInjected = async (e) => {
  var t;
  await pingContentScript(e) || (await ((t = api$1 == null ? void 0 : api$1.scripting) == null ? void 0 : t.executeScript({
    target: { tabId: e },
    files: ["content/all.iife.js"]
  })), await new Promise((n, a) => {
    var A, f;
    const i = setTimeout(() => a(new Error("Content script injection timed out")), 5e3), g = (m) => {
      var R, b;
      (m == null ? void 0 : m.source) === "content-script" && "type" in m.payload && m.payload.type === "pong" && (clearTimeout(i), (b = (R = api$1 == null ? void 0 : api$1.runtime) == null ? void 0 : R.onMessage) == null || b.removeListener(g), n());
    };
    (f = (A = api$1 == null ? void 0 : api$1.runtime) == null ? void 0 : A.onMessage) == null || f.addListener(g);
  }));
}, resolveTabId = async (e) => {
  var t;
  if (e.tabId !== void 0)
    return e.tabId;
  const s = await ((t = api$1 == null ? void 0 : api$1.tabs) == null ? void 0 : t.query({ active: !0, currentWindow: !0 }));
  if (!(s != null && s.length))
    throw new Error("No active tab found");
  return s[0].id;
}, withTimeout = (e, s = COMMAND_TIMEOUT_MS) => Promise.race([
  e,
  new Promise((t, n) => setTimeout(() => n(new Error(`Timeout: command did not complete within ${s}ms`)), s))
]), makeResponse = (e, s) => ({ id: e, success: !0, data: s }), makeErrorResponse = (e, s) => ({ id: e, success: !1, error: s });
var StorageEnum;
(function(e) {
  e.Local = "local", e.Sync = "sync", e.Managed = "managed", e.Session = "session";
})(StorageEnum || (StorageEnum = {}));
var SessionAccessLevelEnum;
(function(e) {
  e.ExtensionPagesOnly = "TRUSTED_CONTEXTS", e.ExtensionPagesAndContentScripts = "TRUSTED_AND_UNTRUSTED_CONTEXTS";
})(SessionAccessLevelEnum || (SessionAccessLevelEnum = {}));
const chrome$1 = globalThis.chrome, updateCache = async (e, s) => {
  const t = (a) => typeof a == "function", n = (a) => (
    // Use ReturnType to infer the return type of the function and check if it's a Promise
    a instanceof Promise
  );
  return t(e) ? (n(e), e(s)) : e;
};
let globalSessionAccessLevelFlag = !1;
const checkStoragePermission = (e) => {
  if (chrome$1 && !chrome$1.storage[e])
    throw new Error(`"storage" permission in manifest.ts: "storage ${e}" isn't defined`);
}, createStorage = (e, s, t) => {
  var v, y;
  let n = null, a = !1, i = [];
  const g = (t == null ? void 0 : t.storageEnum) ?? StorageEnum.Local, A = ((v = t == null ? void 0 : t.serialization) == null ? void 0 : v.serialize) ?? ((u) => u), f = ((y = t == null ? void 0 : t.serialization) == null ? void 0 : y.deserialize) ?? ((u) => u);
  globalSessionAccessLevelFlag === !1 && g === StorageEnum.Session && (t == null ? void 0 : t.sessionAccessForContentScripts) === !0 && (checkStoragePermission(g), chrome$1 == null || chrome$1.storage[g].setAccessLevel({
    accessLevel: SessionAccessLevelEnum.ExtensionPagesAndContentScripts
  }).catch((u) => {
    console.error(u), console.error("Please call .setAccessLevel() into different context, like a background script.");
  }), globalSessionAccessLevelFlag = !0);
  const m = async () => {
    checkStoragePermission(g);
    const u = await (chrome$1 == null ? void 0 : chrome$1.storage[g].get([e]));
    return u ? f(u[e]) ?? s : s;
  }, R = async (u) => {
    a || (n = await m()), n = await updateCache(u, n), await (chrome$1 == null ? void 0 : chrome$1.storage[g].set({ [e]: A(n) })), O();
  }, b = (u) => (i = [...i, u], () => {
    i = i.filter((W) => W !== u);
  }), x = () => n, O = () => {
    i.forEach((u) => u());
  }, C = async (u) => {
    if (u[e] === void 0)
      return;
    const W = f(u[e].newValue);
    n !== W && (n = await updateCache(W, n), O());
  };
  return m().then((u) => {
    n = u, a = !0, O();
  }), chrome$1 == null || chrome$1.storage[g].onChanged.addListener(C), {
    get: m,
    set: R,
    getSnapshot: x,
    subscribe: b
  };
}, storage = createStorage("wolffish-connection-config", { port: 23151 }, {
  storageEnum: StorageEnum.Local
}), wolffishConnectionStorage = {
  ...storage
}, api = globalThis.chrome;
let connectionStatus = "disconnected", connectionPort = DEFAULT_PORT;
const RECONNECT_ALARM = "wolffish-reconnect";
let ws = null, heartbeatTimer = null;
const stopHeartbeat = () => {
  heartbeatTimer !== null && (clearInterval(heartbeatTimer), heartbeatTimer = null);
}, startHeartbeat = () => {
  stopHeartbeat(), heartbeatTimer = setInterval(() => {
    (ws == null ? void 0 : ws.readyState) === WebSocket.OPEN && ws.send(JSON.stringify({ type: "ping" }));
  }, HEARTBEAT_INTERVAL_MS);
}, setStatus = (e) => {
  connectionStatus = e, log(`Connection status: ${e}`), api.runtime.sendMessage({ type: "status_update", status: e, port: connectionPort }).catch(() => {
  });
}, scheduleReconnect = () => {
  api.alarms.create(RECONNECT_ALARM, { delayInMinutes: 0.05 });
};
api.alarms.onAlarm.addListener((e) => {
  e.name === RECONNECT_ALARM && connectionStatus !== "connected" && connectWebSocket(connectionPort);
});
const connectWebSocket = async (e) => {
  ws && (ws.onopen = null, ws.onclose = null, ws.onerror = null, ws.onmessage = null, (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) && ws.close(), ws = null), connectionPort = e;
  try {
    await fetch(`http://localhost:${e}`, { mode: "no-cors" });
  } catch {
    setStatus("disconnected"), scheduleReconnect();
    return;
  }
  setStatus("connecting"), log(`Connecting to ws://localhost:${e}`), ws = new WebSocket(`ws://localhost:${e}`), ws.onopen = () => {
    setStatus("connected"), api.alarms.clear(RECONNECT_ALARM), startHeartbeat(), log("Connected");
    const s = api.runtime.getManifest();
    sendToServer({ type: "extension_info", version: s.version }), sendToServer({ type: "get_conversations" });
  }, ws.onclose = () => {
    setStatus("disconnected"), stopHeartbeat(), log("Disconnected"), scheduleReconnect();
  }, ws.onerror = () => {
    log("WebSocket error");
  }, ws.onmessage = (s) => {
    try {
      const t = JSON.parse(s.data);
      if (t.type === "pong") return;
      if (t.type === "event") {
        handleWolffishEvent(t);
        return;
      }
      if (t.id && t.type) {
        handleCommand(t);
        return;
      }
    } catch (t) {
      logError("Failed to parse WebSocket message", t);
    }
  };
}, sendToServer = (e) => {
  (ws == null ? void 0 : ws.readyState) === WebSocket.OPEN && ws.send(JSON.stringify(e));
}, handleNavigate = async (e) => {
  const { url: s, waitUntil: t } = e, n = await resolveTabId(e);
  if (t) {
    const i = new Promise((g, A) => {
      const f = setTimeout(() => {
        api.webNavigation.onCompleted.removeListener(m), A(new Error(`Navigation timed out waiting for '${t}'`));
      }, COMMAND_TIMEOUT_MS), m = (R) => {
        R.tabId === n && R.frameId === 0 && (clearTimeout(f), api.webNavigation.onCompleted.removeListener(m), g());
      };
      api.webNavigation.onCompleted.addListener(m);
    });
    await api.tabs.update(n, { url: s }), await i;
  } else
    await api.tabs.update(n, { url: s });
  const a = await api.tabs.get(n);
  return { url: a.url || s, title: a.title || "", tabId: n };
}, handleBack = async (e) => {
  const s = await resolveTabId(e);
  return await api.scripting.executeScript({
    target: { tabId: s },
    func: () => history.back()
  }), { success: !0 };
}, handleForward = async (e) => {
  const s = await resolveTabId(e);
  return await api.scripting.executeScript({
    target: { tabId: s },
    func: () => history.forward()
  }), { success: !0 };
}, handleReload = async (e) => {
  const { hard: s } = e, t = await resolveTabId(e);
  return await api.tabs.reload(t, { bypassCache: s ?? !1 }), { success: !0 };
}, handleTabsList = async (e) => {
  const { windowId: s } = e, t = s !== void 0 ? { windowId: s } : {};
  return {
    tabs: (await api.tabs.query(t)).map((a) => ({
      id: a.id,
      url: a.url || "",
      title: a.title || "",
      active: a.active,
      pinned: a.pinned,
      windowId: a.windowId
    }))
  };
}, handleTabOpen = async (e) => {
  const { url: s, active: t } = e, n = await api.tabs.create({ url: s, active: t ?? !0 });
  return {
    tabId: n.id,
    url: n.pendingUrl || n.url || s || ""
  };
}, handleTabClose = async (e) => {
  const { tabId: s } = e;
  return await api.tabs.remove(s), { success: !0 };
}, handleTabSwitch = async (e) => {
  const { tabId: s } = e;
  return await api.tabs.update(s, { active: !0 }), { success: !0 };
}, handleTabDuplicate = async (e) => {
  const { tabId: s } = e, t = await api.tabs.duplicate(s);
  if (!t)
    throw new Error(`Failed to duplicate tab ${s}`);
  return { tabId: t.id };
}, handleTabMove = async (e) => {
  const { tabId: s, index: t, windowId: n } = e, a = { index: t };
  return n !== void 0 && (a.windowId = n), await api.tabs.move(s, a), { success: !0 };
}, handleWindowsList = async () => ({
  windows: (await api.windows.getAll({ populate: !0 })).map((s) => {
    var t;
    return {
      id: s.id,
      focused: s.focused,
      tabs: ((t = s.tabs) == null ? void 0 : t.length) ?? 0,
      type: s.type || "normal",
      state: s.state || "normal"
    };
  })
}), handleWindowOpen = async (e) => {
  const { url: s, incognito: t, width: n, height: a } = e, i = {};
  return s !== void 0 && (i.url = s), t !== void 0 && (i.incognito = t), n !== void 0 && (i.width = n), a !== void 0 && (i.height = a), { windowId: (await api.windows.create(i)).id };
}, handleWindowClose = async (e) => {
  const { windowId: s } = e;
  return await api.windows.remove(s), { success: !0 };
}, handleWindowResize = async (e) => {
  const { windowId: s, width: t, height: n, left: a, top: i, state: g } = e, A = {};
  return t !== void 0 && (A.width = t), n !== void 0 && (A.height = n), a !== void 0 && (A.left = a), i !== void 0 && (A.top = i), g !== void 0 && (A.state = g), await api.windows.update(s, A), { success: !0 };
}, handleScreenshot = async (e) => {
  const { format: s, quality: t, fullPage: n, selector: a } = e;
  if (a || n) {
    const b = await resolveTabId(e);
    return await ensureContentScriptInjected(b), (await sendToContentScript(b, {
      source: "service-worker",
      target: "content-script",
      payload: {
        id: crypto.randomUUID(),
        type: WolffishCommands.BROWSER_SCREENSHOT,
        params: e
      }
    })).data;
  }
  const i = s === "jpeg" ? "jpeg" : "png", g = { format: i };
  i === "jpeg" && t !== void 0 && (g.quality = t);
  const A = await api.tabs.captureVisibleTab(null, g), f = await resolveTabId(e), m = await api.tabs.get(f), R = await api.windows.get(m.windowId);
  return {
    image: A,
    width: R.width || 0,
    height: R.height || 0
  };
}, handlePdf = async (e) => {
  if (isFirefox())
    throw new Error("PDF generation is not supported on Firefox");
  const s = await resolveTabId(e);
  await api.debugger.attach({ tabId: s }, "1.3");
  try {
    return { data: (await api.debugger.sendCommand({ tabId: s }, "Page.printToPDF", {})).data };
  } finally {
    await api.debugger.detach({ tabId: s }).catch(() => {
    });
  }
}, handleCookiesGet = async (e) => {
  const { domain: s, name: t } = e, n = { domain: s };
  return t !== void 0 && (n.name = t), {
    cookies: (await api.cookies.getAll(n)).map((i) => ({
      name: i.name,
      value: i.value,
      domain: i.domain,
      path: i.path,
      expires: i.expirationDate || -1,
      httpOnly: i.httpOnly,
      secure: i.secure
    }))
  };
}, handleCookiesSet = async (e) => {
  const { url: s, name: t, value: n, domain: a, path: i, expires: g, httpOnly: A, secure: f } = e, m = { url: s, name: t, value: n };
  return a !== void 0 && (m.domain = a), i !== void 0 && (m.path = i), g !== void 0 && (m.expirationDate = g), A !== void 0 && (m.httpOnly = A), f !== void 0 && (m.secure = f), await api.cookies.set(m), { success: !0 };
}, handleCookiesRemove = async (e) => {
  const { url: s, name: t } = e;
  return await api.cookies.remove({ url: s, name: t }), { success: !0 };
}, handleDownload = async (e) => {
  const { url: s, filename: t } = e, n = { url: s };
  return t !== void 0 && (n.filename = t), { downloadId: await api.downloads.download(n) };
}, handleExecuteJs = async (params) => {
  var e;
  const { code, world } = params, tabId = await resolveTabId(params), results = await api.scripting.executeScript({
    target: { tabId },
    func: (source) => eval(source),
    args: [code],
    world: world || "ISOLATED"
  });
  return { result: (e = results[0]) == null ? void 0 : e.result };
}, handleWaitForNavigation = async (e) => {
  const { timeout: s } = e, t = await resolveTabId(e), n = s ?? COMMAND_TIMEOUT_MS;
  return new Promise((a, i) => {
    const g = setTimeout(() => {
      api.webNavigation.onCompleted.removeListener(A), i(new Error(`waitForNavigation timed out after ${n}ms`));
    }, n), A = (f) => {
      f.tabId === t && f.frameId === 0 && (clearTimeout(g), api.webNavigation.onCompleted.removeListener(A), api.tabs.get(t).then((m) => {
        a({ url: m.url || f.url, title: m.title || "" });
      }).catch((m) => {
        i(m);
      }));
    };
    api.webNavigation.onCompleted.addListener(A);
  });
}, handleNotify = async (e) => {
  const { title: s, message: t, iconUrl: n } = e;
  return { notificationId: await api.notifications.create("", {
    type: "basic",
    title: s,
    message: t,
    iconUrl: n || api.runtime.getURL("icon-128.png")
  }) };
}, handleGetUrl = async (e) => {
  const s = await resolveTabId(e), t = await api.tabs.get(s);
  return { url: t.url || "", title: t.title || "" };
}, SERVICE_WORKER_HANDLERS = {
  [WolffishCommands.BROWSER_NAVIGATE]: handleNavigate,
  [WolffishCommands.BROWSER_BACK]: handleBack,
  [WolffishCommands.BROWSER_FORWARD]: handleForward,
  [WolffishCommands.BROWSER_RELOAD]: handleReload,
  [WolffishCommands.BROWSER_TABS_LIST]: handleTabsList,
  [WolffishCommands.BROWSER_TAB_OPEN]: handleTabOpen,
  [WolffishCommands.BROWSER_TAB_CLOSE]: handleTabClose,
  [WolffishCommands.BROWSER_TAB_SWITCH]: handleTabSwitch,
  [WolffishCommands.BROWSER_TAB_DUPLICATE]: handleTabDuplicate,
  [WolffishCommands.BROWSER_TAB_MOVE]: handleTabMove,
  [WolffishCommands.BROWSER_WINDOWS_LIST]: handleWindowsList,
  [WolffishCommands.BROWSER_WINDOW_OPEN]: handleWindowOpen,
  [WolffishCommands.BROWSER_WINDOW_CLOSE]: handleWindowClose,
  [WolffishCommands.BROWSER_WINDOW_RESIZE]: handleWindowResize,
  [WolffishCommands.BROWSER_SCREENSHOT]: handleScreenshot,
  [WolffishCommands.BROWSER_PDF]: handlePdf,
  [WolffishCommands.BROWSER_COOKIES_GET]: handleCookiesGet,
  [WolffishCommands.BROWSER_COOKIES_SET]: handleCookiesSet,
  [WolffishCommands.BROWSER_COOKIES_REMOVE]: handleCookiesRemove,
  [WolffishCommands.BROWSER_DOWNLOAD]: handleDownload,
  [WolffishCommands.BROWSER_EXECUTE_JS]: handleExecuteJs,
  [WolffishCommands.BROWSER_WAIT_FOR_NAVIGATION]: handleWaitForNavigation,
  [WolffishCommands.BROWSER_NOTIFY]: handleNotify,
  [WolffishCommands.BROWSER_GET_URL]: handleGetUrl
}, sendResponseToServer = (e) => {
  sendToServer(e);
}, handleCommand = async (e) => {
  log("←", e.type, e.params);
  try {
    let s;
    if (SERVICE_WORKER_COMMANDS.has(e.type)) {
      const t = SERVICE_WORKER_HANDLERS[e.type];
      if (!t)
        s = makeErrorResponse(e.id, `No handler for command: ${e.type}`);
      else {
        const n = await withTimeout(t(e.params));
        s = makeResponse(e.id, n);
      }
    } else if (CONTENT_SCRIPT_COMMANDS.has(e.type)) {
      const t = await resolveTabId(e.params);
      await ensureContentScriptInjected(t), s = await withTimeout(
        sendToContentScript(t, {
          source: "service-worker",
          target: "content-script",
          payload: e
        })
      );
    } else
      s = makeErrorResponse(e.id, `Unknown command: ${e.type}`);
    log("→", e.type, s.success ? "success" : s.error), sendResponseToServer(s);
  } catch (s) {
    const t = s instanceof Error ? s.message : String(s), n = makeErrorResponse(e.id, t);
    log("→", e.type, "error:", n.error), sendResponseToServer(n);
  }
}, CACHE_MAX_CONVERSATIONS = 50, CACHE_MAX_EVENTS = 500, cache = {
  saveConversations(e) {
    const s = e.slice(0, CACHE_MAX_CONVERSATIONS);
    api.storage.local.set({ "wf:conversations": s }).catch(() => {
    });
  },
  saveActive(e) {
    api.storage.local.set({ "wf:active": e }).catch(() => {
    });
  },
  saveEvents(e, s) {
    const t = s.slice(0, CACHE_MAX_EVENTS);
    api.storage.local.set({ [`wf:events:${e}`]: t }).catch(() => {
    });
  },
  async loadAll() {
    try {
      const e = await api.storage.local.get(["wf:conversations", "wf:active"]), s = e["wf:conversations"] ?? [], t = e["wf:active"] ?? null;
      let n = [];
      return t && (n = (await api.storage.local.get([`wf:events:${t}`]))[`wf:events:${t}`] ?? []), { conversations: s, active: t, events: n };
    } catch {
      return { conversations: [], active: null, events: [] };
    }
  },
  async loadEvents(e) {
    try {
      return (await api.storage.local.get([`wf:events:${e}`]))[`wf:events:${e}`] ?? [];
    } catch {
      return [];
    }
  }
};
let cachedEvents = [], cachedConversations = [], activeConversationId = null, cacheRestored = !1;
const handleWolffishEvent = (e) => {
  if (e.event === "port_update") {
    const { port: s } = e.data;
    log(`Port update received: ${s}`), wolffishConnectionStorage.set({ port: s });
    return;
  }
  if (e.event === "extension_reload") {
    log("Received reload command from Wolffish"), api.runtime.reload();
    return;
  }
  if (e.event === "events_sync") {
    const s = e.data;
    activeConversationId = s.conversationId, cachedEvents = (s.events ?? []).slice().reverse(), cache.saveActive(activeConversationId), cache.saveEvents(activeConversationId, cachedEvents), api.runtime.sendMessage({ payload: { event: "events_sync", data: e.data } }).catch(() => {
    });
    return;
  }
  if (e.event === "event_logged") {
    const s = e.data;
    cachedEvents.unshift(s), activeConversationId && cache.saveEvents(activeConversationId, cachedEvents), api.runtime.sendMessage({ payload: { event: "event_logged", data: s } }).catch(() => {
    });
    return;
  }
  if (e.event === "conversations_list") {
    cachedConversations = e.data, cache.saveConversations(cachedConversations), api.runtime.sendMessage({ payload: { event: "conversations_list", data: e.data } }).catch(() => {
    });
    for (const s of cachedConversations)
      sendToServer({ type: "get_conversation_events", conversationId: s.conversationId });
    return;
  }
  if (e.event === "conversation_events") {
    const s = e.data;
    cache.saveEvents(s.conversationId, (s.events ?? []).slice().reverse()), api.runtime.sendMessage({ payload: { event: "conversation_events", data: s } }).catch(() => {
    });
    return;
  }
};
api.runtime.onMessage.addListener((e, s, t) => {
  if (e.type === "get_connection_status") {
    const n = ws && ws.readyState === WebSocket.OPEN ? "connected" : ws && ws.readyState === WebSocket.CONNECTING ? "connecting" : "disconnected";
    return n !== connectionStatus && (connectionStatus = n), t({ status: connectionStatus, port: connectionPort }), !0;
  }
  if (e.type === "get_events")
    return sendToServer({ type: "get_conversations" }), cachedConversations.length > 0 || activeConversationId ? t({
      events: cachedEvents,
      conversations: cachedConversations,
      activeConversation: activeConversationId
    }) : cache.loadAll().then((n) => {
      cachedConversations = n.conversations, activeConversationId = n.active, cachedEvents = n.events, t({
        events: cachedEvents,
        conversations: cachedConversations,
        activeConversation: activeConversationId
      }), api.runtime.sendMessage({ payload: { event: "conversations_list", data: cachedConversations } }).catch(() => {
      });
    }), !0;
  if (e.type === "get_conversation_events" && e.conversationId) {
    const n = e.conversationId;
    return sendToServer({ type: "get_conversation_events", conversationId: n }), cache.loadEvents(n).then((a) => {
      cachedEvents = a, api.runtime.sendMessage({ payload: { event: "conversation_events", data: { conversationId: n, events: a } } }).catch(() => {
      }), t({ events: a });
    }), !0;
  }
  return !1;
});
const startConnection = async () => {
  connectionPort = (await wolffishConnectionStorage.get().catch(() => ({ port: DEFAULT_PORT }))).port, connectWebSocket(connectionPort);
};
api.runtime.onInstalled.addListener(async () => {
  log("Extension installed"), api.sidePanel && api.sidePanel.setPanelBehavior({ openPanelOnActionClick: !0 }), await startConnection();
});
api.runtime.onStartup.addListener(async () => {
  log("Extension started"), api.sidePanel && api.sidePanel.setPanelBehavior({ openPanelOnActionClick: !0 }), await startConnection();
});
wolffishConnectionStorage.subscribe(() => {
  const e = wolffishConnectionStorage.getSnapshot();
  e && e.port !== connectionPort && (log(`Port changed to ${e.port}`), api.alarms.clear(RECONNECT_ALARM), connectWebSocket(e.port));
});
cache.loadAll().then((e) => {
  cacheRestored || (cachedConversations = e.conversations, activeConversationId = e.active, cachedEvents = e.events, cacheRestored = !0, log(`Cache restored: ${e.conversations.length} conversations, ${e.events.length} events`));
}).catch(() => {
});
startConnection().catch((e) => logError("Failed to start connection:", e));
log("Service worker loaded");
