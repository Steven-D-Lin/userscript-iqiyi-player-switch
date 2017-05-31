// ==UserScript==
// @name         iqiyi player switch
// @namespace    https://github.com/gooyie/userscript-iqiyi-player-switch
// @homepageURL  https://github.com/gooyie/userscript-iqiyi-player-switch
// @supportURL   https://github.com/gooyie/userscript-iqiyi-player-switch/issues
// @updateURL    https://raw.githubusercontent.com/gooyie/userscript-iqiyi-player-switch/master/iqiyi-player-switch.user.js
// @version      1.7.0
// @description  iqiyi player switch between flash and html5
// @author       gooyie
// @license      MIT License
//
// @include      *://*.iqiyi.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @grant        GM_log
// @grant        unsafeWindow
// @require      https://greasyfork.org/scripts/29319-web-streams-polyfill/code/web-streams-polyfill.js?version=191261
// @require      https://greasyfork.org/scripts/29306-fetch-readablestream/code/fetch-readablestream.js?version=191832
// @require      https://cdnjs.cloudflare.com/ajax/libs/webrtc-adapter/3.3.4/adapter.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/blueimp-md5/2.7.0/js/md5.min.js
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const PLAYER_TYPE = {
        Html5VOD: 'h5_VOD',
        FlashVOD: 'flash_VOD'
    };

    class Logger {

        static get tag() {
            return `[${GM_info.script.name}]: `;
        }

        static log(msg) {
            GM_log(this.tag + msg);
        }

    }

    class Cookies {

        static get(key) {
            let value;
            if (new RegExp('^[^\\x00-\\x20\\x7f\\(\\)<>@,;:\\\\\\"\\[\\]\\?=\\{\\}\\/\\u0080-\\uffff]+$').test(key)) { // eslint-disable-line no-control-regex
                let re = new RegExp('(^| )' + key + '=([^;]*)(;|$)');
                let rs = re.exec(document.cookie);
                value = rs ? rs[2] : '';
            }
            return value ? decodeURIComponent(value) : '';
        }

        static set(k, v, o={}) {
            let n = o.expires;
            if ('number' == typeof o.expires) {
                n = new Date();
                n.setTime(n.getTime() + o.expires);
            }
            let key = k;
            let value = encodeURIComponent(v);
            let path = o.path ? '; path=' + o.path : '';
            let expires = n ? '; expires=' + n.toGMTString() : '';
            let domain = o.domain ? '; domain=' + o.domain : '';
            document.cookie = `${key}=${value}${path}${expires}${domain}`;
        }

        static remove(k, o={}) {
            o.expires = new Date(0);
            this.set(k, '', o);
        }

    }

    class Detector {

        static isSupportHtml5() {
            let v = document.createElement('video');
            return !!(
                v.canPlayType('audio/mp4; codecs="mp4a.40.2"') &&
                v.canPlayType('video/mp4; codecs="avc1.640029"') &&
                v.canPlayType('video/mp4; codecs="avc1.640029, mp4a.40.2"')
            );
        }

        static isSupportVms() {
            return !!(
                window.MediaSource && window.URL && window.WebSocket && window.ReadableStream &&
                (window.RTCSessionDescription || window.webkitRTCSessionDescription) &&
                (window.RTCPeerConnection || window.webkitRTCPeerConnection) &&
                (window.RTCIceCandidate || window.webkitRTCIceCandidate)
            );
        }

        static isSupportM3u8() {
            let v = document.createElement('video');
            return !!(
                v.canPlayType('application/x-mpegurl') &&
                v.canPlayType('application/vnd.apple.mpegurl')
            );
        }

        static isChrome() {
            return /chrome/i.test(navigator.userAgent);
        }

        static isFirefox() {
            return /firefox/i.test(navigator.userAgent);
        }

        static isEdge() {
            return /edge/i.test(navigator.userAgent);
        }

    }

    class Hooker {

        static hookCall(cb = ()=>{}) {

            const call = Function.prototype.call;
            Function.prototype.call = function(...args) {
                let ret = call.bind(this)(...args);
                if (args) cb(...args);
                return ret;
            };

            Function.prototype.call.toString = Function.prototype.call.toLocaleString = function() {
                return 'function call() { [native code] }';
            };

        }

        static _isFactoryCall(args) { // module.exports, module, module.exports, require
            return args.length === 4 && 'object' === typeof args[1] && args[1].hasOwnProperty('exports');
        }

        static hookFactoryCall(cb = ()=>{}) {
            this.hookCall((...args) => {if (this._isFactoryCall(args)) cb(...args);});
        }

        static _isJqueryFactoryCall(exports) {
            return exports.hasOwnProperty('fn') && exports.fn.hasOwnProperty('jquery');
        }

        static hookJquery(cb = ()=>{}) {
            this.hookFactoryCall((...args) => {if (this._isJqueryFactoryCall(args[1].exports)) cb(...args);});
        }

        static hookJqueryAjax(cb = ()=>{}) {
            this.hookJquery((...args) => {
                let exports = args[1].exports;

                const ajax = exports.ajax.bind(exports);

                exports.ajax = function(url, options = {}) {
                    if (typeof url === 'object') {
                        [url, options] = [url.url, url];
                    }

                    let isHijacked = cb(url, options);
                    if (isHijacked) return;

                    return ajax(url, options);
                };
            });
        }

        static _isHttpFactoryCall(exports = {}) {
            return exports.hasOwnProperty('jsonp') && exports.hasOwnProperty('ajax');
        }

        static hookHttp(cb = ()=>{}) {
            this.hookFactoryCall((...args) => {if (this._isHttpFactoryCall(args[1].exports)) cb(...args);});
        }

        static hookHttpJsonp(cb = ()=>{}) {
            this.hookHttp((...args) => {
                let exports = args[1].exports;

                const jsonp = exports.jsonp.bind(exports);

                exports.jsonp = function(options) {
                    let isHijacked = cb(options);
                    if (isHijacked) return;
                    return jsonp(options);
                };
            });
        }

        static _isLogoFactoryCall(exports = {}) {
            return 'function' === typeof exports && exports.prototype.hasOwnProperty('showLogo');
        }

        static hookLogo(cb = ()=>{}) {
            this.hookFactoryCall((...args) => {if (this._isLogoFactoryCall(args[1].exports)) cb(args[1].exports);});
        }

    }

    class Faker {

        static fakeMacPlatform() {
            const PLAFORM_MAC = 'mac';
            Object.defineProperty(unsafeWindow.navigator, 'platform', {get: () => PLAFORM_MAC});
        }

        static fakeSafari() {
            const UA_SAFARY = 'safari';
            Object.defineProperty(unsafeWindow.navigator, 'userAgent', {get: () => UA_SAFARY});
        }

        static fakeChrome() {
            const UA_CHROME = 'chrome';
            Object.defineProperty(unsafeWindow.navigator, 'userAgent', {get: () => UA_CHROME});
        }

        static _calcSign(authcookie) {
            const RESPONSE_KEY = '-0J1d9d^ESd)9jSsja';
            return md5(authcookie.substring(5, 39).split('').reverse().join('') + '<1<' + RESPONSE_KEY);
        }

        static fakeVipRes(authcookie) {
            let json = {
                code: 'A00000',
                data: {
                    sign: this._calcSign(authcookie)
                }
            };
            return json;
        }

        static fakeAdRes() {
            let json = {};
            return json;
        }

        static fakePassportCookie() {
            Cookies.set('P00001', 'faked_passport', {domain: '.iqiyi.com'});
            Logger.log(`faked passport cookie`);
        }

    }

    class Mocker {

        static mock() {
            let currType = GM_getValue('player_forcedType', PLAYER_TYPE.Html5VOD);

            if (currType === PLAYER_TYPE.Html5VOD) {
                if (!Detector.isSupportHtml5()) {
                    alert('╮(╯▽╰)╭ 你的浏览器播放不了html5视频~~~~');
                    return;
                }

                this.forceHtml5();
                this.mockForBestDefintion();
                this.mockAd();
                this.mockVip();
                this.mockLogo();
            } else {
                this.forceFlash();
            }

            window.addEventListener('unload', event => this.destroy());
        }

        static forceHtml5() {
            Logger.log(`setting player_forcedType cookie as ${PLAYER_TYPE.Html5VOD}`);
            Cookies.set('player_forcedType', PLAYER_TYPE.Html5VOD, {domain: '.iqiyi.com'});
        }

        static forceFlash() {
            Logger.log(`setting player_forcedType cookie as ${PLAYER_TYPE.FlashVOD}`);
            Cookies.set('player_forcedType', PLAYER_TYPE.FlashVOD, {domain: '.iqiyi.com'});
        }

        static mockToUseVms() {
            Faker.fakeChrome();
        }

        static mockToUseM3u8() {
            Faker.fakeMacPlatform();
            Faker.fakeSafari();
        }

        static _isVideoReq(url) {
            return /^https?:\/\/(?:\d+.?){4}\/videos\/v.*$/.test(url);
        }

        static mockForBestDefintion() {
            // apply shims
            if (Detector.isFirefox()) {
                const fetch = unsafeWindow.fetch.bind(unsafeWindow);

                unsafeWindow.fetch = (url, opts) => {
                    if (this._isVideoReq(url)) {
                        Logger.log(`fetching stream ${url}`);
                        return fetchStream(url, opts); // xhr with moz-chunked-arraybuffer
                    } else {
                        return fetch(url, opts);
                    }
                };
            } else if (Detector.isEdge()) {
                // export to the global window object
                unsafeWindow.RTCIceCandidate = window.RTCIceCandidate;
                unsafeWindow.RTCPeerConnection = window.RTCPeerConnection;
                unsafeWindow.RTCSessionDescription = window.RTCSessionDescription;
            }
            // auto fall-back
            if (Detector.isSupportVms()) {
                if (!Detector.isChrome()) this.mockToUseVms(); // vms, 1080p or higher
            } else if (Detector.isSupportM3u8()) {
                this.mockToUseM3u8(); // tmts m3u8
            } else {
                // by default, tmts mp4 ...
            }
        }

        static _isAdReq(url) {
            const AD_URL = 'http://t7z.cupid.iqiyi.com/show2';
            return url.indexOf(AD_URL) === 0;
        }

        static mockAd() {
            Hooker.hookJqueryAjax((url, options) => {
                if (this._isAdReq(url)) {
                    let res = Faker.fakeAdRes();
                    (options.complete || options.success)({responseJSON: res}, 'success');
                    Logger.log(`mocked ad request ${url}`);
                    return true;
                }
            });
        }

        static _isCheckVipReq(url) {
            const CHECK_VIP_URL = 'https://cmonitor.iqiyi.com/apis/user/check_vip.action';
            return url === CHECK_VIP_URL;
        }

        static _isLogin() {
            return !!Cookies.get('P00001');
        }

        static mockVip() {
            if (!this._isLogin()) Faker.fakePassportCookie();

            Hooker.hookHttpJsonp((options) => {
                let url = options.url;

                if (this._isCheckVipReq(url)) {
                    let res = Faker.fakeVipRes(options.params.authcookie);
                    options.success(res);
                    Logger.log(`mocked check vip request ${url}`);
                    return true;
                }
            });
        }

        static mockLogo() {
            Hooker.hookLogo(exports => exports.prototype.showLogo = ()=>{});
        }

        static destroy() {
            Cookies.remove('player_forcedType', {domain: '.iqiyi.com'});
            if (Cookies.get('P00001') === 'faked_passport') Cookies.remove('P00001', {domain: '.iqiyi.com'});
            Logger.log(`removed cookies.`);
        }

    }

    class Switcher {

        static switchTo(toType) {
            Logger.log(`switching to ${toType} ...`);

            GM_setValue('player_forcedType', toType);
            document.location.reload();
        }

    }

    function registerMenu() {
        const MENU_NAME = {
            HTML5: 'HTML5播放器',
            FLASH: 'Flash播放器'
        };

        let currType = GM_getValue('player_forcedType', PLAYER_TYPE.Html5VOD); // 默认为Html5播放器，免去切换。
        let [toType, name] = currType === PLAYER_TYPE.Html5VOD ? [PLAYER_TYPE.FlashVOD, MENU_NAME.FLASH] : [PLAYER_TYPE.Html5VOD, MENU_NAME.HTML5];
        GM_registerMenuCommand(name, () => Switcher.switchTo(toType), null);
        Logger.log(`registered menu.`);
    }


    registerMenu();
    Mocker.mock();

})();
